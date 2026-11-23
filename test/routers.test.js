"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");
const { getStarterBlinkyModel } = require("../src/common/rustContract");

const StudioRouter = require("../src/routers/StudioRouter/StudioRouter");
const RustSimRouter = require("../src/routers/RustSimRouter/RustSimRouter");
const GitRouterAdapter = require("../src/routers/GitRouterAdapter/GitRouterAdapter");
const RootRouter = require("../src/routers/RootRouter/RootRouter");

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

  it("validates default, dev, and prod configurations with expected UI deployment flags", () => {
    const defCfg = require("../config/config.default");
    const devCfg = require("../config/config.dev");
    const prodCfg = require("../config/config.prod");

    assert.equal(defCfg.rest.components.root.mount, "");
    assert.equal(defCfg.rest.components.studio.options.serveWebGMEUI, true);
    assert.equal(defCfg.rest.components.studio.options.rootToStudio, false);

    assert.equal(devCfg.rest.components.studio.options.serveWebGMEUI, true);
    assert.equal(devCfg.rest.components.studio.options.rootToStudio, false);

    assert.equal(prodCfg.rest.components.studio.options.serveWebGMEUI, false);
    assert.equal(prodCfg.rest.components.studio.options.rootToStudio, true);
  });

  it("serves RootRouter + StudioRouter accurately across dev, hybrid, and user-facing modes", async () => {
    async function probeMode(studioOpts) {
      const modeApp = express();
      const gmeConfig = {
        seedProjects: { defaultProject: "RustySeed" },
        authentication: { enable: false },
        rest: { components: { studio: { options: studioOpts } } },
      };
      modeApp.use("/", RootRouter.createRouter({ gmeConfig }));
      modeApp.use("/routers/studio", StudioRouter.createRouter({ gmeConfig }));
      modeApp.get(["/", "/index.html"], (_req, res) => {
        res.status(200).send("<html><title>Generic WebGME UI</title></html>");
      });

      const srv = http.createServer(modeApp);
      await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${srv.address().port}`;
      try {
        const rootText = await (await fetch(`${url}/`)).text();
        const idxText = await (await fetch(`${url}/index.html`)).text();
        const info = await (await fetch(`${url}/routers/studio/api/info`)).json();
        return { rootText, idxText, info };
      } finally {
        await new Promise((resolve) => srv.close(resolve));
      }
    }

    // 1. Dev default: both enabled, `/` -> Generic WebGME UI
    const devRes = await probeMode({ serveWebGMEUI: true, rootToStudio: false });
    assert.match(devRes.rootText, /Generic WebGME UI/);
    assert.match(devRes.idxText, /Generic WebGME UI/);
    assert.equal(devRes.info.serveWebGMEUI, true);
    assert.equal(devRes.info.rootToStudio, false);
    assert.equal(devRes.info.webgmeUrl, "/");

    // 2. Dev hybrid (`RUSTY_ROOT_TO_STUDIO=true`): `/` -> Studio, `/index.html` -> Generic WebGME UI
    const hybridRes = await probeMode({ serveWebGMEUI: true, rootToStudio: true });
    assert.match(hybridRes.rootText, /<title>Rusty Studio<\/title>/);
    assert.match(hybridRes.idxText, /Generic WebGME UI/);
    assert.equal(hybridRes.info.serveWebGMEUI, true);
    assert.equal(hybridRes.info.rootToStudio, true);
    assert.equal(hybridRes.info.webgmeUrl, "/index.html");

    // 3. User-facing / prod (`serveWebGMEUI: false`): `/` AND `/index.html` -> Studio, link hidden
    const prodRes = await probeMode({ serveWebGMEUI: false, rootToStudio: true });
    assert.match(prodRes.rootText, /<title>Rusty Studio<\/title>/);
    assert.match(prodRes.idxText, /<title>Rusty Studio<\/title>/);
    assert.equal(prodRes.info.serveWebGMEUI, false);
    assert.equal(prodRes.info.rootToStudio, true);
    assert.equal(prodRes.info.webgmeUrl, null);
  });
});
