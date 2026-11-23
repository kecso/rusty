"use strict";

/**
 * End-to-End Integration Test for Rusty running on real `webgme.standaloneServer`
 * with Layer 1 (`webgme-engine` generic OIDC) + Layer 2 (`webgme-git` `/profile` & `/routers/gitrouter`).
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { MongoClient } = require("mongodb");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function createMockOidcServer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "rusty-mock-oidc-1";
  jwk.use = "sig";
  jwk.alg = "RS256";

  const codes = new Map();
  const tokens = new Map();
  let baseUrl = "";

  const user = {
    sub: "oidc-rusty-alice",
    preferred_username: "alice",
    email: "alice@example.com",
    name: "Alice Rusty",
  };

  function signJwt(payload) {
    const headerB64 = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid }), "utf8").toString("base64url");
    const nowSec = Math.floor(Date.now() / 1000);
    const payloadB64 = Buffer.from(
      JSON.stringify({ iat: nowSec, exp: nowSec + 300, iss: baseUrl, ...payload }),
      "utf8",
    ).toString("base64url");
    const input = `${headerB64}.${payloadB64}`;
    const sig = crypto.sign("RSA-SHA256", Buffer.from(input, "utf8"), privateKey).toString("base64url");
    return `${input}.${sig}`;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, baseUrl || "http://127.0.0.1");
    if (req.method === "GET" && reqUrl.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          userinfo_endpoint: `${baseUrl}/userinfo`,
          jwks_uri: `${baseUrl}/jwks`,
          response_types_supported: ["code"],
        }),
      );
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/jwks") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/authorize") {
      const redirectUri = reqUrl.searchParams.get("redirect_uri");
      const state = reqUrl.searchParams.get("state") || "";
      const code = crypto.randomBytes(12).toString("hex");
      codes.set(code, {
        clientId: reqUrl.searchParams.get("client_id"),
        nonce: reqUrl.searchParams.get("nonce") || null,
        codeChallenge: reqUrl.searchParams.get("code_challenge") || null,
      });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }

    if (req.method === "POST" && reqUrl.pathname === "/token") {
      const parsed = new URLSearchParams(await readBody(req));
      const code = parsed.get("code");
      const entry = code ? codes.get(code) : null;
      if (code) codes.delete(code);

      if (!entry || parsed.get("grant_type") !== "authorization_code") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }

      if (entry.codeChallenge) {
        const verifier = parsed.get("code_verifier") || "";
        const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (!verifier || expected !== entry.codeChallenge) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_grant_pkce" }));
          return;
        }
      }

      const accessToken = crypto.randomBytes(16).toString("hex");
      tokens.set(accessToken, user);
      const idToken = signJwt({
        aud: entry.clientId,
        ...user,
        ...(entry.nonce ? { nonce: entry.nonce } : {}),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        }),
      );
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/userinfo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(user));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          baseUrl = `http://127.0.0.1:${port}`;
          resolve({ baseUrl, discoveryUrl: `${baseUrl}/.well-known/openid-configuration` });
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function createCookieClient() {
  const cookies = new Map();

  function ingest(res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const [first, ...attrs] = String(raw).split(";");
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const val = first.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^max-age=0$/i.test(a.trim())) || val === "";
      if (expired) cookies.delete(name);
      else cookies.set(name, val);
    }
  }

  return {
    cookies,
    async req(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (cookies.size > 0) {
        headers.Cookie = Array.from(cookies.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      }
      const res = await fetch(url, {
        method: opts.method || "GET",
        headers,
        redirect: "manual",
      });
      ingest(res);
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_err) {
        json = null;
      }
      return { status: res.status, headers: res.headers, text, json };
    },
  };
}

describe("Rusty E2E Layer 1 (OIDC) + Layer 2 (webgme-git) Server", { timeout: 30000 }, () => {
  const mongoDbName = `rusty_e2e_${process.pid}_${Date.now()}`;
  const mongoUri = `mongodb://127.0.0.1:27017/${mongoDbName}`;
  const originalEnv = { ...process.env };

  let mongoClient;
  let mongoAvailable = false;
  let mockOidc;
  let oidcInfo;
  let server;
  let baseUrl;
  let blobDir;

  function clearConfigCache() {
    for (const modPath of [
      "webgme-engine/config/config.default",
      "webgme/config/config.default",
      "../config/config.default",
      "../config/config.prod",
    ]) {
      try {
        delete require.cache[require.resolve(modPath)];
      } catch (_err) {
        // Ignore if not cached
      }
    }
  }

  before(async (t) => {
    try {
      mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2000 });
      await mongoClient.connect();
      await mongoClient.db(mongoDbName).dropDatabase();
      mongoAvailable = true;
    } catch (err) {
      if (mongoClient) {
        await mongoClient.close().catch(() => {});
        mongoClient = null;
      }
      t.skip(`MongoDB not available on 127.0.0.1:27017 (${err.message})`);
      return;
    }

    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), "rusty-e2e-blob-"));
    mockOidc = createMockOidcServer();
    oidcInfo = await mockOidc.start();

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    process.env.PORT = String(port);
    process.env.MONGO_URI = mongoUri;
    process.env.WEBGME_BASE_URL = baseUrl;
    process.env.RUSTY_AUTH = "true";
    process.env.OAUTH_PROVIDER = "oidc";
    process.env.OAUTH_DISCOVERY_URL = oidcInfo.discoveryUrl;
    process.env.OAUTH_CLIENT_ID = "rusty-e2e-client";
    delete process.env.OAUTH_CLIENT_SECRET;
    delete process.env.OAUTH_REDIRECT_URI;
    delete process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;

    clearConfigCache();
    const webgme = require("webgme");
    const validateConfig = require("webgme/config/validator");
    const cfg = require("../config/config.prod");
    cfg.server.maxWorkers = 1;
    cfg.server.log.transports = [
      {
        transportType: "Console",
        options: { level: "error", colorize: false, timestamp: false, prettyPrint: false },
      },
    ];
    cfg.blob.fsDir = blobDir;
    cfg.authentication.salts = 1;
    validateConfig(cfg);

    webgme.addToRequireJsPaths(cfg);
    server = webgme.standaloneServer(cfg);
    await new Promise((resolve, reject) => {
      server.start((err) => (err ? reject(err) : resolve()));
    });
  });

  after(async () => {
    process.env = { ...originalEnv };
    clearConfigCache();

    if (server) {
      await new Promise((resolve) => server.stop(() => resolve()));
    }
    try {
      const verifyOAuthToken = require("webgme-engine/src/server/middleware/auth/verifyOAuthToken");
      verifyOAuthToken.clearCache();
    } catch (_err) {
      // Ignore
    }
    if (mongoClient) {
      await mongoClient.db(mongoDbName).dropDatabase().catch(() => {});
      await mongoClient.close().catch(() => {});
    }
    if (mockOidc) {
      await mockOidc.stop();
    }
    if (blobDir) {
      fs.rmSync(blobDir, { recursive: true, force: true });
    }
  });

  it("enforces prod auth, logs in via Layer 1 OIDC, serves Studio, and exposes /routers/gitrouter/status", async (t) => {
    if (!mongoAvailable) {
      t.skip("MongoDB not running");
      return;
    }

    const client = createCookieClient();

    // 1. Unauthenticated / redirects to /profile/login
    const unauthRoot = await client.req(`${baseUrl}/`);
    assert.equal(unauthRoot.status, 302);
    assert.match(unauthRoot.headers.get("location"), /^\/profile\/login/);

    // 2. /profile/login reflects Layer 1 OIDC config
    const loginPage = await client.req(`${baseUrl}/profile/login`);
    assert.equal(loginPage.status, 200);
    assert.match(loginPage.text, /data-oauth-enable="true"/);
    assert.match(loginPage.text, /data-oauth-provider="oidc"/);
    assert.match(loginPage.text, /data-password-login="false"/);

    // 3. Layer 1 OIDC login flow -> issues access_token cookie
    const oauthLoginRes = await client.req(`${baseUrl}/oauth/login`);
    assert.equal(oauthLoginRes.status, 302);
    const idpAuthUrl = oauthLoginRes.headers.get("location");
    assert.ok(idpAuthUrl.startsWith(oidcInfo.baseUrl));

    const idpRes = await fetch(idpAuthUrl, { redirect: "manual" });
    assert.equal(idpRes.status, 302);
    const cbUrl = idpRes.headers.get("location");
    assert.ok(cbUrl.startsWith(`${baseUrl}/oauth/callback`));

    const cbRes = await client.req(cbUrl);
    assert.equal(cbRes.status, 302);
    assert.ok(client.cookies.has("access_token"), "Layer 1 must issue access_token JWT cookie");

    // 4. Authenticated / serves Rusty Studio directly in prod mode
    const authRoot = await client.req(`${baseUrl}/`);
    assert.equal(authRoot.status, 200);
    assert.match(authRoot.text, /<title>Rusty Studio<\/title>/);

    // 5. StudioRouter /api/info reports Layer 1 OAuth + Layer 2 GitHub connect URL
    const infoRes = await client.req(`${baseUrl}/routers/studio/api/info`);
    assert.equal(infoRes.status, 200);
    assert.equal(infoRes.json.authEnabled, true);
    assert.equal(infoRes.json.oauthEnabled, true);
    assert.equal(infoRes.json.oauthProvider, "oidc");
    assert.equal(infoRes.json.githubConnectUrl, "/profile/github/connect");

    // 6. Native GitRouter /status reports Layer 1 authenticated session with unlinked GitHub
    const gitStatus = await client.req(`${baseUrl}/routers/gitrouter/status`);
    assert.equal(gitStatus.status, 200);
    assert.equal(gitStatus.json.authEnabled, true);
    assert.equal(gitStatus.json.authenticated, true);
    assert.equal(gitStatus.json.userId, "alice");
    assert.equal(gitStatus.json.hasGithubToken, false);
    assert.equal(gitStatus.json.profileUrl, "/profile");
    assert.equal(gitStatus.json.connectUrl, "/profile/github/connect");
  });
});
