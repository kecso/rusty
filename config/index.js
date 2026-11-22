/* eslint-env node */
"use strict";

const env = process.env.NODE_ENV || "default";
const configFilename = __dirname + "/config." + env + ".js";
const config = require(configFilename);
const validateConfig = require("webgme/config/validator");

validateConfig(config);
module.exports = config;
