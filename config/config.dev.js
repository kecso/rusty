/* eslint-env node */
"use strict";

const config = require("./config.default");
const validateConfig = require("webgme/config/validator");

// Dev mode: keep guest access enabled unless RUSTY_AUTH=true is explicitly set
if (process.env.RUSTY_AUTH !== "true") {
  config.authentication.enable = false;
  config.authentication.allowGuests = true;
}

validateConfig(config);
module.exports = config;
