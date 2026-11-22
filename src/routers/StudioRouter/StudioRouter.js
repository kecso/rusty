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

function initialize(middlewareOpts) {
  if (initialized) return;
  initialized = true;

  const opts = middlewareOpts || {};
  const gmeConfig = opts.gmeConfig || {};

  // Self-hosted Monaco Editor assets (zero CDN dependency)
  const monacoVsDir = resolveMonacoVsDir();
  if (monacoVsDir) {
    router.use("/vendor/monaco/vs", express.static(monacoVsDir, { maxAge: "1d" }));
  }

  // Shared UMD modules (single source of truth for Node + Browser)
  router.use("/common", express.static(COMMON_DIR));

  // Built VitePress documentation & interactive tutorials
  if (fs.existsSync(DOCS_DIST_DIR)) {
    router.use("/docs", express.static(DOCS_DIST_DIR, { maxAge: "1h" }));
  } else {
    router.use("/docs", (_req, res) => {
      res
        .status(200)
        .type("html")
        .send(
          '<!doctype html><html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:32px"><h2>Rusty Docs Not Built Yet</h2><p>Run <code>npm run docs:build</code> (or <code>npm run docs:dev</code>) to build the VitePress tutorials.</p></body></html>',
        );
    });
  }

  // Runtime metadata for the Studio SPA
  router.get("/api/info", (_req, res) => {
    res.json({
      appName: "Rusty Studio",
      defaultSeed: (gmeConfig.seedProjects && gmeConfig.seedProjects.defaultProject) || "RustySeed",
      authEnabled: Boolean(gmeConfig.authentication && gmeConfig.authentication.enable),
      githubAppConfigured: Boolean(
        process.env.GITHUB_APP_CLIENT_ID &&
          process.env.GITHUB_APP_CLIENT_SECRET &&
          process.env.TOKEN_ENCRYPTION_KEY,
      ),
      webgmeUrl: "/",
      profileUrl: "/profile",
      gitRouterBase: "/routers/gitrouter",
      rustSimBase: "/routers/rustsim",
    });
  });

  // Static Studio assets
  router.use(express.static(PUBLIC_DIR));

  // SPA fallback
  router.get("/", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
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
