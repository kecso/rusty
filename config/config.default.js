/* eslint-env node */
"use strict";

require("dotenv").config();

const path = require("path");
const config = require("webgme/config/config.default");
const validateConfig = require("webgme/config/validator");
const gitConfig = require("webgme-git/config/config.webgme.fragment");

const ROOT = path.resolve(__dirname, "..");

config.server.port = Number(process.env.PORT || 8888);
config.mongo.uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/rusty_webgme";
config.server.bodyParser = { json: { limit: "10mb" } };

// Register Rusty seeds (RustySeed.webgmex) + webgme-git's git-seed.webgmex
config.seedProjects.enable = true;
config.seedProjects.defaultProject = "RustySeed";
config.seedProjects.basePaths = [
  path.join(ROOT, "seed"),
  path.join(path.dirname(require.resolve("webgme-git/package.json")), "seed"),
];

// Register Rusty plugins
config.plugin.allowServerExecution = true;
config.plugin.basePaths = config.plugin.basePaths || [];
config.plugin.basePaths.push(path.join(ROOT, "src/plugins"));

// Register WebGME REST routers:
//   - /routers/gitrouter : webgme-git GitRouter wired to WebGME gmeAuth & ProjectRepoStore
//   - /routers/rustsim   : Rust crate check & native simulation runner
//   - /routers/studio    : Rusty State Machine Design Studio SPA (reads/writes via GME.classes.Client)
config.rest.components.gitrouter = {
  src: path.join(ROOT, "src/routers/GitRouterAdapter/GitRouterAdapter.js"),
  mount: "routers/gitrouter",
};
config.rest.components.rustsim = {
  src: path.join(ROOT, "src/routers/RustSimRouter/RustSimRouter.js"),
  mount: "routers/rustsim",
};
config.rest.components.studio = {
  src: path.join(ROOT, "src/routers/StudioRouter/StudioRouter.js"),
  mount: "routers/studio",
};

// Enable GitHub-native authentication & webgme-git /profile pages when configured
const githubAuthRequested =
  process.env.RUSTY_AUTH === "true" ||
  Boolean(process.env.GITHUB_APP_CLIENT_ID && process.env.TOKEN_ENCRYPTION_KEY);

if (githubAuthRequested) {
  Object.assign(config.authentication, gitConfig.authentication);
  config.authentication.jwt.privateKey =
    process.env.JWT_PRIVATE_KEY_PATH || config.authentication.jwt.privateKey;
  config.authentication.jwt.publicKey =
    process.env.JWT_PUBLIC_KEY_PATH || config.authentication.jwt.publicKey;
} else {
  config.authentication.enable = false;
  config.authentication.allowGuests = true;
}

validateConfig(config);
module.exports = config;
