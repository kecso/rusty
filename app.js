/* eslint-env node */
"use strict";

require("dotenv").config();

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
  console.log("==========================================================");
  console.log(`  Rusty State Machine Studio : ${baseUrl}/routers/studio`);
  console.log(`  WebGME Generic UI          : ${baseUrl}/`);
  console.log(`  webgme-git Router          : ${baseUrl}/routers/gitrouter/status`);
  console.log(`  Rust Sim / Verify Router   : ${baseUrl}/routers/rustsim/health`);
  if (gmeConfig.authentication.enable) {
    console.log(`  GitHub Profile & Admin     : ${baseUrl}/profile`);
  } else {
    console.log("  Auth mode                  : Guest/Dev (set RUSTY_AUTH=true for GitHub OAuth)");
  }
  console.log("==========================================================");
});
