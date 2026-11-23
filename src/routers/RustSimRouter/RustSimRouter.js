/* eslint-env node */
"use strict";

/**
 * WebGME RestRouter at `/routers/rustsim`.
 *
 * Composes a complete Rust crate from a WebGME StateMachine model + per-state Rust code
 * and runs real `cargo check` / `cargo run` verification in an isolated temp workspace.
 */

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { generateCrateFiles } = require("../../common/rustCodegen");

const router = express.Router();
let initialized = false;

const CARGO_TIMEOUT_MS = 25000;

function runExecFile(bin, args, opts) {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(bin, args, { timeout: CARGO_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        durationMs: Date.now() - start,
        errorMessage: err ? err.message : null,
      });
    });
  });
}

function writeCrateToTempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rusty-sim-"));
  for (const [relPath, content] of Object.entries(files)) {
    const safeRel = relPath.replace(/^\/+/, "");
    if (safeRel.includes("..")) continue;
    const full = path.join(dir, safeRel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(content), "utf8");
  }
  return dir;
}

function parseCargoJsonDiagnostics(stdout) {
  const diagnostics = [];
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.reason === "compiler-message" && obj.message) {
        const msg = obj.message;
        const primarySpan = (msg.spans || []).find((s) => s.is_primary) || (msg.spans || [])[0];
        diagnostics.push({
          level: msg.level || "error",
          code: msg.code ? msg.code.code : null,
          message: msg.message || "",
          file: primarySpan ? primarySpan.file_name : null,
          line: primarySpan ? primarySpan.line_start : null,
          column: primarySpan ? primarySpan.column_start : null,
          rendered: msg.rendered || msg.message || "",
        });
      }
    } catch (_err) {
      // Ignore non-JSON lines
    }
  }
  return diagnostics;
}

function sanitizeEventArg(ev) {
  return String(ev || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "");
}

function initialize(/* middlewareOpts */) {
  if (initialized) return;
  initialized = true;

  const jsonParser = express.json({ limit: "2mb" });
  router.use((req, res, next) => {
    if (req._body || req.readableEnded || !req.readable) return next();
    return jsonParser(req, res, next);
  });

  router.get("/health", async (_req, res) => {
    const [rustc, cargo] = await Promise.all([
      runExecFile("rustc", ["--version"], {}),
      runExecFile("cargo", ["--version"], {}),
    ]);
    res.json({
      available: rustc.ok && cargo.ok,
      rustc: rustc.ok ? rustc.stdout.trim() : null,
      cargo: cargo.ok ? cargo.stdout.trim() : null,
    });
  });

  router.post("/generate", (req, res) => {
    try {
      const model = req.body && req.body.model;
      if (!model || !Array.isArray(model.states)) {
        res.status(400).json({ error: "Request body must include { model: { states: [...] } }" });
        return;
      }
      const files = generateCrateFiles(model);
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/check", async (req, res) => {
    const model = req.body && req.body.model;
    if (!model || !Array.isArray(model.states) || model.states.length === 0) {
      res.status(400).json({ error: "Model must include at least one state" });
      return;
    }

    let tmpDir = null;
    try {
      const files = generateCrateFiles(model);
      tmpDir = writeCrateToTempDir(files);
      const result = await runExecFile("cargo", ["check", "--offline", "--message-format=json"], {
        cwd: tmpDir,
      });
      const diagnostics = parseCargoJsonDiagnostics(result.stdout);
      res.json({
        ok: result.ok,
        durationMs: result.durationMs,
        diagnostics,
        rawStderr: result.stderr,
        fileCount: Object.keys(files).length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });

  router.post("/run", async (req, res) => {
    const model = req.body && req.body.model;
    const rawEvents = Array.isArray(req.body && req.body.events) ? req.body.events : [];
    if (!model || !Array.isArray(model.states) || model.states.length === 0) {
      res.status(400).json({ error: "Model must include at least one state" });
      return;
    }

    const events = rawEvents.slice(0, 100).map(sanitizeEventArg).filter(Boolean);
    let tmpDir = null;
    try {
      const files = generateCrateFiles(model);
      tmpDir = writeCrateToTempDir(files);
      const result = await runExecFile("cargo", ["run", "--offline", "--quiet", "--", ...events], {
        cwd: tmpDir,
      });

      const trace = [];
      for (const line of result.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          trace.push(JSON.parse(trimmed));
        } catch (_err) {
          // skip
        }
      }

      res.json({
        ok: result.ok,
        durationMs: result.durationMs,
        trace,
        rawStderr: result.stderr,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    } finally {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
}

function start(callback) {
  if (typeof callback === "function") callback(null);
}

function stop(callback) {
  if (typeof callback === "function") callback(null);
}

module.exports = {
  initialize,
  router,
  start,
  stop,
};
