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

function resolveMonacoVsDir() {
  const candidates = [
    path.resolve(__dirname, "../../../node_modules/monaco-editor/min/vs"),
    path.resolve(__dirname, "../../../../cps-build-studio/node_modules/monaco-editor/min/vs"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
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
