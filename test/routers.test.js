"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { getStarterBlinkyModel } = require("../src/common/rustContract");

const StudioRouter = require("../src/routers/StudioRouter/StudioRouter");
const RustSimRouter = require("../src/routers/RustSimRouter/RustSimRouter");
const GitRouterAdapter = require("../src/routers/GitRouterAdapter/GitRouterAdapter");

describe("Rusty WebGME Routers", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = express();
    const mockOpts = {
      gmeConfig: {
        seedProjects: { defaultProject: "RustySeed" },
        authentication: { enable: false },
      },
      logger: { fork: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    };

    StudioRouter.initialize(mockOpts);
    RustSimRouter.initialize(mockOpts);
    GitRouterAdapter.initialize(mockOpts);

    app.use("/routers/studio", StudioRouter.router);
    app.use("/routers/rustsim", RustSimRouter.router);
    app.use("/routers/gitrouter", GitRouterAdapter.router);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("serves StudioRouter /api/info and shared common modules", async () => {
    const infoRes = await fetch(`${baseUrl}/routers/studio/api/info`);
    assert.equal(infoRes.status, 200);
    const info = await infoRes.json();
    assert.equal(info.appName, "Rusty Studio");
    assert.equal(info.defaultSeed, "RustySeed");

    const jsRes = await fetch(`${baseUrl}/routers/studio/common/rustSimEngine.js`);
    assert.equal(jsRes.status, 200);
    const body = await jsRes.text();
    assert.match(body, /createSimulation/);

    const analyzerRes = await fetch(`${baseUrl}/routers/studio/common/rustAnalyzer.js`);
    assert.equal(analyzerRes.status, 200);
    assert.match(await analyzerRes.text(), /analyzeStateCode/);

    const monacoRes = await fetch(`${baseUrl}/routers/studio/vendor/monaco/vs/loader.js`);
    assert.equal(monacoRes.status, 200);

    const docsRes = await fetch(`${baseUrl}/routers/studio/docs/`);
    assert.equal(docsRes.status, 200);
    assert.match(await docsRes.text(), /Rusty/);
  });

  it("serves GitRouterAdapter /status", async () => {
    const res = await fetch(`${baseUrl}/routers/gitrouter/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.githubAppConfigured, "boolean");
    assert.equal(data.profileUrl, "/profile");
  });

  it("verifies and runs BlinkyController via RustSimRouter /check and /run", async () => {
    const healthRes = await fetch(`${baseUrl}/routers/rustsim/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.available, true);

    const model = getStarterBlinkyModel();

    const checkRes = await fetch(`${baseUrl}/routers/rustsim/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    assert.equal(checkRes.status, 200);
    const check = await checkRes.json();
    assert.equal(check.ok, true);

    const runRes = await fetch(`${baseUrl}/routers/rustsim/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, events: ["Start", "Tick", "Stop"] }),
    });
    assert.equal(runRes.status, 200);
    const run = await runRes.json();
    assert.equal(run.ok, true);
    assert.equal(run.trace.length, 4);
    assert.equal(run.trace[1].to, "LedOn");
    assert.equal(run.trace[2].to, "LedOff");
    assert.equal(run.trace[3].to, "Idle");
  });
});
