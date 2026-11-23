/* eslint-env node */
"use strict";

/**
 * WebGME RestRouter at `/routers/studio`.
 *
 * Serves the Rusty State Machine Design Studio SPA directly from the WebGME server
 * so the UI shares the exact same origin, auth cookies, WebSocket, and `/gme-dist/webgme.classes.build.js`
 * as WebGME itself.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
let initialized = false;

const PUBLIC_DIR = path.join(__dirname, "public");
const COMMON_DIR = path.resolve(__dirname, "../../common");
const DOCS_DIST_DIR = path.resolve(__dirname, "../../../docs/.vitepress/dist");

function resolveMonacoVsDir() {
  try {
    const vsDir = path.dirname(require.resolve("monaco-editor"));
    if (fs.existsSync(path.join(vsDir, "loader.js"))) return vsDir;
  } catch (_err) {
    // fallback to package-local node_modules
  }
  const localDir = path.resolve(__dirname, "../../../node_modules/monaco-editor/min/vs");
  return fs.existsSync(path.join(localDir, "loader.js")) ? localDir : null;
}

function resolveStudioOptions(gmeConfig) {
  const studioOpts =
    (gmeConfig &&
      gmeConfig.rest &&
      gmeConfig.rest.components &&
      gmeConfig.rest.components.studio &&
      gmeConfig.rest.components.studio.options) ||
    {};
  const serveWebGMEUI = studioOpts.serveWebGMEUI !== false;
  const rootToStudio = Boolean(studioOpts.rootToStudio || !serveWebGMEUI);
  return {
    serveWebGMEUI,
    rootToStudio,
    webgmeUrl: serveWebGMEUI ? (rootToStudio ? "/index.html" : "/") : null,
  };
}

function createRouter(middlewareOpts) {
  const r = express.Router();
  const opts = middlewareOpts || {};
  const gmeConfig = opts.gmeConfig || {};
  const ui = resolveStudioOptions(gmeConfig);
  const authEnabled = Boolean(gmeConfig.authentication && gmeConfig.authentication.enable);
  const authMw =
    authEnabled && typeof opts.ensureAuthenticated === "function"
      ? opts.ensureAuthenticated
      : (_req, _res, next) => next();

  // Guard the SPA entry routes when authentication is enabled
  r.get(["/", "/index.html"], authMw, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  // Self-hosted Monaco Editor assets (zero CDN dependency)
  const monacoVsDir = resolveMonacoVsDir();
  if (monacoVsDir) {
    r.use("/vendor/monaco/vs", express.static(monacoVsDir, { maxAge: "1d" }));
  }

  // Shared UMD modules (single source of truth for Node + Browser)
  r.use("/common", express.static(COMMON_DIR));

  // Built VitePress documentation & interactive tutorials (dynamically checked)
  const docsStatic = express.static(DOCS_DIST_DIR, { maxAge: "1h" });
  r.use("/docs", (req, res, next) => {
    if (fs.existsSync(DOCS_DIST_DIR)) {
      return docsStatic(req, res, next);
    }
    return res
      .status(200)
      .type("html")
      .send(
        '<!doctype html><html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:32px"><h2>Rusty Docs Not Built Yet</h2><p>Run <code>npm run docs:build</code> (or <code>npm run docs:dev</code>) to build the VitePress tutorials.</p></body></html>',
      );
  });

  // Runtime metadata for the Studio SPA
  r.get("/api/info", (_req, res) => {
    const docsAvailable = fs.existsSync(DOCS_DIST_DIR);
    res.json({
      appName: "Rusty Studio",
      defaultSeed: (gmeConfig.seedProjects && gmeConfig.seedProjects.defaultProject) || "RustySeed",
      authEnabled,
      loginUrl: authEnabled
        ? (gmeConfig.authentication && gmeConfig.authentication.logInUrl) || "/profile/login"
        : null,
      logoutUrl: authEnabled ? "/logout" : null,
      githubAppConfigured: Boolean(
        process.env.GITHUB_APP_CLIENT_ID &&
          process.env.GITHUB_APP_CLIENT_SECRET &&
          process.env.TOKEN_ENCRYPTION_KEY,
      ),
      docsAvailable,
      docsUrl: docsAvailable ? "/docs" : null,
      serveWebGMEUI: ui.serveWebGMEUI,
      rootToStudio: ui.rootToStudio,
      webgmeUrl: ui.webgmeUrl,
      profileUrl: authEnabled ? "/profile" : null,
      gitRouterBase: "/routers/gitrouter",
      rustSimBase: "/routers/rustsim",
    });
  });

  // Static Studio assets (index: false so / and /index.html always pass through authMw above)
  r.use(express.static(PUBLIC_DIR, { index: false }));

  return r;
}

function initialize(middlewareOpts) {
  if (initialized) return;
  initialized = true;
  router.use(createRouter(middlewareOpts));
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
  createRouter,
  resolveStudioOptions,
  start,
  stop,
};
