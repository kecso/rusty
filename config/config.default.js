/* eslint-env node */
"use strict";

require("dotenv").config();

const path = require("path");
delete require.cache[require.resolve("webgme-engine/config/config.default")];
delete require.cache[require.resolve("webgme/config/config.default")];
const config = require("webgme/config/config.default");
const validateConfig = require("webgme/config/validator");
const { applyGitConfig } = require("webgme-git/config/config.webgme.fragment");
const { configureLayer1OAuth, hasOAuthEnv } = require("./configureOAuth");

const ROOT = path.resolve(__dirname, "..");

config.server.port = Number(process.env.PORT || 8888);
config.mongo.uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/rusty_webgme";
config.server.bodyParser = { json: { limit: "10mb" } };

// Register Rusty seed first; applyGitConfig() appends webgme-git's git-seed.webgmex
config.seedProjects.enable = true;
config.seedProjects.defaultProject = "RustySeed";
config.seedProjects.basePaths = [path.join(ROOT, "seed")];

// Register Rusty plugins
config.plugin.allowServerExecution = true;
config.plugin.basePaths = config.plugin.basePaths || [];
config.plugin.basePaths.push(path.join(ROOT, "src/plugins"));

// Wire Layer 2 (`webgme-git`): native GitRouter at /routers/gitrouter,
// optional /profile user/repo portal, and git-seed.webgmex without overwriting Layer 1 auth
applyGitConfig(config, { gitRouterOpts: { requireProjectId: false } });

// Register Rusty-specific WebGME REST routers:
//   - /routers/rustsim   : Rust crate check & native simulation runner
//   - /routers/studio    : Rusty State Machine Design Studio SPA (reads/writes via GME.classes.Client)
config.rest.components.rustsim = {
  src: path.join(ROOT, "src/routers/RustSimRouter/RustSimRouter.js"),
  mount: "routers/rustsim",
};
const studioOnly = process.env.RUSTY_STUDIO_ONLY === "true";
const serveWebGMEUI = studioOnly
  ? false
  : process.env.RUSTY_SERVE_WEBGME_UI !== undefined
    ? process.env.RUSTY_SERVE_WEBGME_UI === "true"
    : true;
const rootToStudio =
  studioOnly || !serveWebGMEUI
    ? true
    : process.env.RUSTY_ROOT_TO_STUDIO === "true";

config.rest.components.studio = {
  src: path.join(ROOT, "src/routers/StudioRouter/StudioRouter.js"),
  mount: "routers/studio",
  options: {
    serveWebGMEUI,
    rootToStudio,
  },
};
config.rest.components.root = {
  src: path.join(ROOT, "src/routers/RootRouter/RootRouter.js"),
  mount: "",
};

// Layer 1 WebGME authentication (`webgme-engine` OAuth 2.0 / OIDC or local password login)
const authRequested = process.env.RUSTY_AUTH === "true" || hasOAuthEnv(process.env);

if (authRequested) {
  config.authentication.enable = true;
  config.authentication.allowGuests = false;
  config.authentication.logInUrl = "/profile/login";
  config.authentication.logOutUrl = "/profile/login";
  configureLayer1OAuth(config, process.env);
  config.authentication.jwt.privateKey =
    process.env.JWT_PRIVATE_KEY_PATH || config.authentication.jwt.privateKey;
  config.authentication.jwt.publicKey =
    process.env.JWT_PUBLIC_KEY_PATH || config.authentication.jwt.publicKey;
} else {
  config.authentication.enable = false;
  config.authentication.allowGuests = true;
  config.authentication.oauth.enable = false;
}

validateConfig(config);
module.exports = config;
