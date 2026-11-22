/* eslint-env node */
"use strict";

/**
 * WebGME RestRouter adapter for `webgme-git`.
 *
 * Bridges webgme-engine's modern RestRouter contract (`initialize`, `router`, `start`, `stop`)
 * with `webgme-git`'s stateless `GitRouter`, wiring:
 *   - WebGME `gmeAuth` encrypted `githubAuth` token read/write
 *   - `projectRepoStore` per-project GitHub repository allowlist
 *   - `GET /status` introspection endpoint for the Rusty Studio UI
 */

const express = require("express");
const webgmeGit = require("webgme-git");

const router = express.Router();
let initialized = false;

function isGitHubAppConfigured() {
  return Boolean(
    process.env.GITHUB_APP_CLIENT_ID &&
      process.env.GITHUB_APP_CLIENT_SECRET &&
      process.env.TOKEN_ENCRYPTION_KEY,
  );
}

function initialize(middlewareOpts) {
  if (initialized) return;
  initialized = true;

  const opts = middlewareOpts || {};
  const gmeAuth = opts.gmeAuth;
  const gmeConfig = opts.gmeConfig || {};
  const logger = opts.logger ? opts.logger.fork("gitrouter") : console;
  const ensureAuthenticated = opts.ensureAuthenticated;
  const getUserId = opts.getUserId;

  // Shared or fallback projectRepoStore
  const projectRepoStore =
    (opts.gitDeps && opts.gitDeps.projectRepoStore) ||
    new webgmeGit.projectRepoStore.MemoryProjectRepoStore();

  function resolveUserId(req) {
    if (typeof getUserId === "function") {
      const id = getUserId(req);
      if (id) return id;
    }
    if (req.userData && (req.userData._id || req.userData.userId)) {
      return req.userData._id || req.userData.userId;
    }
    return req.userId || null;
  }

  // Public status endpoint so Rusty Studio can show accurate GitHub connection state
  router.get("/status", async (req, res) => {
    const userId = resolveUserId(req);
    let hasGithubToken = false;
    let githubLogin = null;

    if (userId && gmeAuth && typeof gmeAuth.getUser === "function") {
      try {
        const user = await gmeAuth.getUser(userId);
        if (user && user.data && user.data.githubAuth && user.data.githubAuth.token) {
          hasGithubToken = true;
          githubLogin = user.data.githubAuth.login || null;
        }
      } catch (_err) {
        // Guest or lookup failure — report false
      }
    }

    res.setHeader("Cache-Control", "no-store, private");
    res.json({
      githubAppConfigured: isGitHubAppConfigured(),
      authEnabled: Boolean(gmeConfig.authentication && gmeConfig.authentication.enable),
      authenticated: Boolean(userId && userId !== "guest"),
      userId: userId || "guest",
      hasGithubToken,
      githubLogin,
      profileUrl: "/profile",
    });
  });

  // Populate req.userData for all downstream webgme-git GitRouter routes
  if (typeof ensureAuthenticated === "function") {
    router.use((req, res, next) => {
      ensureAuthenticated(req, res, (err) => {
        if (err) return next(err);
        const uid = resolveUserId(req);
        if (uid && !req.userData) {
          req.userData = { _id: uid, userId: uid };
        }
        next();
      });
    });
  }

  const gitDeps = {
    projectRepoStore,
    requireProjectId: false,
    async getGithubAuthForUser(userId) {
      if (!gmeAuth || typeof gmeAuth.getUser !== "function") {
        const err = new Error("WebGME gmeAuth not available for GitHub token lookup");
        err.status = 501;
        throw err;
      }
      const user = await gmeAuth.getUser(userId);
      const githubAuth = user && user.data && user.data.githubAuth;
      if (!githubAuth || !githubAuth.token) {
        const err = new Error(
          "No GitHub OAuth token linked to this WebGME user. Sign in via /profile with GitHub.",
        );
        err.status = 401;
        throw err;
      }
      return githubAuth;
    },
    async saveGithubAuthForUser(userId, nextGithubAuth) {
      if (!gmeAuth || typeof gmeAuth.getUser !== "function") return;
      const user = await gmeAuth.getUser(userId);
      if (!user) return;
      const nextData = { ...(user.data || {}), githubAuth: nextGithubAuth };
      if (typeof gmeAuth.updateUser === "function") {
        await gmeAuth.updateUser(userId, { data: nextData });
      }
    },
    async getUserProfile(userId) {
      if (!gmeAuth || typeof gmeAuth.getUser !== "function") {
        return { name: userId || "Rusty User", email: "rusty@localhost" };
      }
      try {
        const user = await gmeAuth.getUser(userId);
        return {
          name: (user && (user.displayName || user._id)) || userId,
          email: (user && user.email) || `${userId}@users.noreply.github.com`,
        };
      } catch (_err) {
        return { name: userId || "Rusty User", email: "rusty@localhost" };
      }
    },
    ...(opts.gitDeps || {}),
  };

  const innerRouter = webgmeGit.GitRouter.getRouter({ ...opts, gitDeps }, gmeConfig);
  router.use(innerRouter);
  logger.debug("Mounted webgme-git GitRouterAdapter");
}

function start(callback) {
  if (typeof callback === "function") callback(null);
}

function stop(callback) {
  if (typeof callback === "function") callback(null);
}

module.exports = {
  initialize,
  router,
  start,
  stop,
};
