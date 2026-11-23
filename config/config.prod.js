/* eslint-env node */
"use strict";

/**
 * User-facing / production configuration (`NODE_ENV=prod` or `npm run start:prod`).
 *
 * Disables WebGME's generic UI and serves Rusty Studio directly at `/`
 * unless explicitly overridden with `RUSTY_SERVE_WEBGME_UI=true`.
 */

delete require.cache[require.resolve("./config.default")];
const config = require("./config.default");
const validateConfig = require("webgme/config/validator");

const studioOpts = config.rest.components.studio.options;
if (process.env.RUSTY_SERVE_WEBGME_UI !== "true") {
  studioOpts.serveWebGMEUI = false;
  studioOpts.rootToStudio = true;
} else if (process.env.RUSTY_ROOT_TO_STUDIO === undefined) {
  studioOpts.rootToStudio = true;
}

validateConfig(config);
module.exports = config;
