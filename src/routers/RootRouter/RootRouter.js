/* eslint-env node */
"use strict";

/**
 * WebGME RestRouter mounted at `/` (`mount: ""`) that controls:
 *   - Serving Rusty Studio at `/` / `/index.html` based on deployment flags
 *   - Public `/docs` shortcut to locally built VitePress docs when present
 *
 * Mounted before WebGME's built-in `['', '/', '/index.html']` route in standalone.js,
 * while letting all API, gme-dist, gmeConfig.json, socket.io, /profile, and /routers/* paths
 * pass through cleanly.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const STUDIO_INDEX = path.resolve(__dirname, "../StudioRouter/public/index.html");
const DOCS_DIST_DIR = path.resolve(__dirname, "../../../docs/.vitepress/dist");

function resolveUiFlags(middlewareOpts) {
  const gmeConfig = (middlewareOpts && middlewareOpts.gmeConfig) || {};
  const studioCfg =
    gmeConfig.rest &&
    gmeConfig.rest.components &&
    gmeConfig.rest.components.studio &&
    gmeConfig.rest.components.studio.options;
  const opts = studioCfg || {};
  const serveWebGMEUI = opts.serveWebGMEUI !== false;
  const rootToStudio = Boolean(opts.rootToStudio || !serveWebGMEUI);
  return { serveWebGMEUI, rootToStudio };
}

function createRouter(middlewareOpts) {
  const opts = middlewareOpts || {};
  const { serveWebGMEUI, rootToStudio } = resolveUiFlags(opts);
  const authEnabled = Boolean(
    opts.gmeConfig && opts.gmeConfig.authentication && opts.gmeConfig.authentication.enable,
  );
  const authMw =
    authEnabled && typeof opts.ensureAuthenticated === "function"
      ? opts.ensureAuthenticated
      : (_req, _res, next) => next();

  const router = express.Router();

  router.get("/docs", (_req, res, next) => {
    if (!fs.existsSync(DOCS_DIST_DIR)) return next();
    return res.redirect(302, "/routers/studio/docs/");
  });

  router.get("/docs/*", (req, res, next) => {
    if (!fs.existsSync(DOCS_DIST_DIR)) return next();
    const tail = req.originalUrl.replace(/^\/docs\/?/, "");
    return res.redirect(302, `/routers/studio/docs/${tail}`);
  });

  router.get("/", authMw, (_req, res, next) => {
    if (rootToStudio) {
      return res.sendFile(STUDIO_INDEX);
    }
    return next();
  });

  router.get("/index.html", authMw, (_req, res, next) => {
    if (!serveWebGMEUI) {
      return res.sendFile(STUDIO_INDEX);
    }
    return next();
  });

  return router;
}

const router = express.Router();
let initialized = false;

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
  resolveUiFlags,
  start,
  stop,
};
