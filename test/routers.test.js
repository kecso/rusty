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

  it("validates default, dev, and prod configurations with expected UI deployment and auth flags", () => {
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
    assert.equal(prodCfg.authentication.enable, true);
    assert.equal(prodCfg.authentication.allowGuests, false);
    assert.equal(prodCfg.authentication.logInUrl, "/profile/login");
    assert.equal(prodCfg.authentication.logOutUrl, "/profile/login");
  });

  it("serves RootRouter + StudioRouter accurately across dev, hybrid, user-facing, /docs, and auth modes", async () => {
    const fs = require("fs");
    const path = require("path");
    const docsBuilt = fs.existsSync(path.resolve(__dirname, "../docs/.vitepress/dist"));

    async function probeMode({ studioOpts, authEnabled = false, cookie = "" }) {
      const modeApp = express();
      const gmeConfig = {
        seedProjects: { defaultProject: "RustySeed" },
        authentication: authEnabled
          ? { enable: true, allowGuests: false, logInUrl: "/profile/login", logOutUrl: "/profile/login" }
          : { enable: false },
        rest: { components: { studio: { options: studioOpts } } },
      };
      const fakeEnsureAuth = (req, res, next) => {
        if ((req.headers.cookie || "").includes("access_token=ok")) return next();
        return res.redirect("/profile/login?redirect=" + encodeURIComponent(req.originalUrl));
      };
      modeApp.use("/", RootRouter.createRouter({ gmeConfig, ensureAuthenticated: fakeEnsureAuth }));
      modeApp.use("/routers/studio", StudioRouter.createRouter({ gmeConfig, ensureAuthenticated: fakeEnsureAuth }));
      const webgmeAuthMw = authEnabled ? fakeEnsureAuth : (_req, _res, next) => next();
      modeApp.get(["/", "/index.html"], webgmeAuthMw, (_req, res) => {
        res.status(200).send("<html><title>Generic WebGME UI</title></html>");
      });

      const srv = http.createServer(modeApp);
      await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${srv.address().port}`;
      try {
        const headers = cookie ? { cookie } : {};
        const rootRes = await fetch(`${url}/`, { redirect: "manual", headers });
        const rootText = rootRes.status === 200 ? await rootRes.text() : "";
        const idxRes = await fetch(`${url}/index.html`, { redirect: "manual", headers });
        const idxText = idxRes.status === 200 ? await idxRes.text() : "";
        const studioRes = await fetch(`${url}/routers/studio/`, { redirect: "manual", headers });
        const docsRes = await fetch(`${url}/docs`, { redirect: "manual" });
        const docsSubRes = await fetch(`${url}/docs/getting-started.html`, { redirect: "manual" });
        const info = await (await fetch(`${url}/routers/studio/api/info`)).json();
        return { rootRes, rootText, idxRes, idxText, studioRes, docsRes, docsSubRes, info };
      } finally {
        await new Promise((resolve) => srv.close(resolve));
      }
    }

    // 1. Dev default: both enabled, `/` -> Generic WebGME UI, no auth required
    const devRes = await probeMode({ studioOpts: { serveWebGMEUI: true, rootToStudio: false } });
    assert.match(devRes.rootText, /Generic WebGME UI/);
    assert.match(devRes.idxText, /Generic WebGME UI/);
    assert.equal(devRes.info.serveWebGMEUI, true);
    assert.equal(devRes.info.rootToStudio, false);
    assert.equal(devRes.info.webgmeUrl, "/");
    assert.equal(devRes.info.authEnabled, false);
    assert.equal(devRes.info.logoutUrl, null);
    assert.equal(devRes.info.docsAvailable, docsBuilt);
    if (docsBuilt) {
      assert.equal(devRes.info.docsUrl, "/docs");
      assert.equal(devRes.docsRes.status, 302);
      assert.equal(devRes.docsRes.headers.get("location"), "/routers/studio/docs/");
      assert.equal(devRes.docsSubRes.status, 302);
      assert.equal(devRes.docsSubRes.headers.get("location"), "/routers/studio/docs/getting-started.html");
    }

    // 2. Dev hybrid (`RUSTY_ROOT_TO_STUDIO=true`): `/` -> Studio, `/index.html` -> Generic WebGME UI
    const hybridRes = await probeMode({ studioOpts: { serveWebGMEUI: true, rootToStudio: true } });
    assert.match(hybridRes.rootText, /<title>Rusty Studio<\/title>/);
    assert.match(hybridRes.idxText, /Generic WebGME UI/);
    assert.equal(hybridRes.info.serveWebGMEUI, true);
    assert.equal(hybridRes.info.rootToStudio, true);
    assert.equal(hybridRes.info.webgmeUrl, "/index.html");

    // 3. User-facing / prod unauthenticated (`authEnabled: true`): `/` & `/routers/studio/` redirect to `/profile/login`
    const unauthProd = await probeMode({
      studioOpts: { serveWebGMEUI: false, rootToStudio: true },
      authEnabled: true,
    });
    assert.equal(unauthProd.rootRes.status, 302);
    assert.match(unauthProd.rootRes.headers.get("location"), /^\/profile\/login/);
    assert.equal(unauthProd.studioRes.status, 302);
    assert.match(unauthProd.studioRes.headers.get("location"), /^\/profile\/login/);
    assert.equal(unauthProd.info.authEnabled, true);
    assert.equal(unauthProd.info.logoutUrl, "/logout");

    // 4. User-facing / prod authenticated: `/` AND `/index.html` -> Studio, Generic UI hidden
    const authProd = await probeMode({
      studioOpts: { serveWebGMEUI: false, rootToStudio: true },
      authEnabled: true,
      cookie: "access_token=ok",
    });
    assert.equal(authProd.rootRes.status, 200);
    assert.match(authProd.rootText, /<title>Rusty Studio<\/title>/);
    assert.equal(authProd.idxRes.status, 200);
    assert.match(authProd.idxText, /<title>Rusty Studio<\/title>/);
    assert.equal(authProd.studioRes.status, 200);
    assert.equal(authProd.info.serveWebGMEUI, false);
    assert.equal(authProd.info.rootToStudio, true);
    assert.equal(authProd.info.webgmeUrl, null);
    assert.equal(authProd.info.logoutUrl, "/logout");
  });
});
