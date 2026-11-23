/* eslint-env node */
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const gmeConfig = require("./config");
const webgme = require("webgme");

webgme.addToRequireJsPaths(gmeConfig);

const server = webgme.standaloneServer(gmeConfig);
server.start((err) => {
  if (err) {
    console.error("[rusty] Failed to start WebGME server:", err);
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${gmeConfig.server.port}`;
  const studioOpts =
    (gmeConfig.rest &&
      gmeConfig.rest.components &&
      gmeConfig.rest.components.studio &&
      gmeConfig.rest.components.studio.options) ||
    {};
  const serveWebGMEUI = studioOpts.serveWebGMEUI !== false;
  const rootToStudio = Boolean(studioOpts.rootToStudio || !serveWebGMEUI);
  const docsAvailable = fs.existsSync(path.join(__dirname, "docs/.vitepress/dist"));
  const studioUrl = rootToStudio ? `${baseUrl}/` : `${baseUrl}/routers/studio`;
  const webgmeUrl = !serveWebGMEUI
    ? "Disabled (user-facing studio-only mode)"
    : rootToStudio
      ? `${baseUrl}/index.html`
      : `${baseUrl}/`;

  console.log("==========================================================");
  console.log(`  Rusty State Machine Studio : ${studioUrl}`);
  if (rootToStudio) {
    console.log(`  Studio Direct Alias        : ${baseUrl}/routers/studio`);
  }
  if (docsAvailable) {
    console.log(`  Docs & Tutorials           : ${baseUrl}/docs`);
  }
  console.log(`  WebGME Generic UI          : ${webgmeUrl}`);
  console.log(`  webgme-git Router          : ${baseUrl}/routers/gitrouter/status`);
  console.log(`  Rust Sim / Verify Router   : ${baseUrl}/routers/rustsim/health`);
  if (gmeConfig.authentication.enable) {
    const oauthCfg = gmeConfig.authentication.oauth || {};
    const authSummary = oauthCfg.enable
      ? `OAuth (${oauthCfg.providerName || "oauth"})${gmeConfig.authentication.allowPasswordLogin ? " + Password" : ""}`
      : "Local Password";
    console.log(`  Auth & Profile             : ${authSummary} (${baseUrl}/profile/login · ${baseUrl}/logout)`);
    if (
      !(
        process.env.GITHUB_APP_CLIENT_ID &&
        process.env.GITHUB_APP_CLIENT_SECRET &&
        process.env.TOKEN_ENCRYPTION_KEY
      )
    ) {
      console.info(
        "  [i] Note: Layer 2 GitHub App sync is disabled until GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY are set in .env.",
      );
    }
  } else {
    console.log("  Auth mode                  : Guest/Dev (set RUSTY_AUTH=true or NODE_ENV=prod for Layer 1 auth)");
  }
  console.log("==========================================================");
});
