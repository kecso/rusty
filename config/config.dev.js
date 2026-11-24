/* eslint-env node */
"use strict";

delete require.cache[require.resolve("./config.default")];
const config = require("./config.default");
const validateConfig = require("webgme/config/validator");
const { applyProfileOpenTargets } = require("./profileTargets");

// Dev mode: keep guest access + both UIs enabled unless explicitly overridden
if (process.env.RUSTY_AUTH !== "true") {
  config.authentication.enable = false;
  config.authentication.allowGuests = true;
  if (config.authentication.oauth) {
    config.authentication.oauth.enable = false;
  }
}

if (
  process.env.RUSTY_STUDIO_ONLY === undefined &&
  process.env.RUSTY_SERVE_WEBGME_UI === undefined &&
  process.env.RUSTY_ROOT_TO_STUDIO === undefined
) {
  config.rest.components.studio.options.serveWebGMEUI = true;
  config.rest.components.studio.options.rootToStudio = false;
}

applyProfileOpenTargets(config);
validateConfig(config);
module.exports = config;
