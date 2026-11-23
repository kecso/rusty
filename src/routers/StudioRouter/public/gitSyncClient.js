(function (global) {
  "use strict";

  /**
   * Client wrapper for `webgme-git` mounted at `/routers/gitrouter`,
   * plus directory-level sweeping for StateMachine import.
   */
  class GitSyncClient {
    constructor(baseUrl = "/routers/gitrouter") {
      this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async _json(url, opts = {}) {
      const res = await fetch(url, {
        credentials: "same-origin",
        ...opts,
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_err) {
        data = { error: text };
      }
      return { ok: res.ok, status: res.status, data };
    }

    async getStatus() {
      const { ok, data } = await this._json(`${this.baseUrl}/status`);
      if (!ok) throw new Error(data.error || "Failed to query gitrouter status");
      return data;
    }

    async listRepos() {
      const { ok, data } = await this._json(`${this.baseUrl}/repos`);
      if (!ok) throw new Error(data.error || "Failed to list GitHub repositories");
      return data.repositories || [];
    }

    async listRefs(owner, repo, projectId) {
      const q = new URLSearchParams({ owner, repo });
      if (projectId) q.set("projectId", projectId);
      const { ok, data } = await this._json(`${this.baseUrl}/refs?${q}`);
      if (!ok) throw new Error(data.error || "Failed to list refs");
      return data.refs || [];
    }

    async fetchFile({ owner, repo, path, ref, projectId }) {
      const q = new URLSearchParams({ owner, repo, path });
      if (ref) q.set("ref", ref);
      if (projectId) q.set("projectId", projectId);
      const { ok, status, data } = await this._json(`${this.baseUrl}/tree?${q}`);
      if (!ok) {
        const err = new Error(data.error || `GitHub fetch failed (${status})`);
        err.status = status;
        throw err;
      }
      return data;
    }

    /**
     * Sweep a GitHub crate or states directory into `{ path: utf8Content }`.
     * Uses authenticated `/routers/gitrouter/tree` first and falls back to GitHub's
     * public Contents API when unauthenticated for public repositories.
     */
    async sweepDirectoryFiles({ owner, repo, dirPath, ref, projectId }) {
      const cleanDir = String(dirPath || "").trim().replace(/^\/+|\/+$/g, "");
      const files = {};
      let usePublicApi = false;

      const fetchTreeOrPublic = async (targetPath) => {
        if (!usePublicApi) {
          try {
            return await this.fetchFile({ owner, repo, path: targetPath, ref, projectId });
          } catch (err) {
            if (err.status === 401 || err.status === 403 || err.status === 501) {
              usePublicApi = true;
            } else {
              throw err;
            }
          }
        }
        const encodedPath = targetPath
          .split("/")
          .filter(Boolean)
          .map(encodeURIComponent)
          .join("/");
        const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}${refQ}`;
        const res = await fetch(apiUrl, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) {
          throw new Error(`GitHub public fetch failed (${res.status}) for ${targetPath}`);
        }
        const payload = await res.json();
        if (Array.isArray(payload)) {
          return {
            type: "dir",
            entries: payload.map((e) => ({ name: e.name, path: e.path, type: e.type })),
          };
        }
        const rawB64 = String(payload.content || "").replace(/\n/g, "");
        return {
          type: "file",
          path: payload.path,
          content: rawB64 ? decodeURIComponent(escape(atob(rawB64))) : "",
        };
      };

      const walk = async (curPath, depth) => {
        if (depth > 3) return;
        const node = await fetchTreeOrPublic(curPath);
        if (node.type === "file") {
          files[node.path || curPath] = node.content || "";
          return;
        }
        const entries = node.entries || [];
        await Promise.all(
          entries.map(async (entry) => {
            if (entry.type === "file") {
              if (entry.name === "Cargo.toml" || (entry.name.endsWith(".rs") && !entry.name.startsWith("."))) {
                const fileRes = await fetchTreeOrPublic(entry.path);
                if (fileRes.type === "file") {
                  files[entry.path] = fileRes.content || "";
                }
              }
            } else if (entry.type === "dir" && (entry.name === "src" || entry.name === "states")) {
              await walk(entry.path, depth + 1);
            }
          }),
        );
      };

      await walk(cleanDir, 0);
      return files;
    }

    async commit({ owner, repo, branch, expectedParentSha, message, changes, projectId }) {
      const headers = { "Content-Type": "application/json" };
      if (projectId) headers["X-WebGME-Project-Id"] = projectId;

      const { ok, status, data } = await this._json(`${this.baseUrl}/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          owner,
          repo,
          branch,
          expectedParentSha: expectedParentSha || undefined,
          message,
          changes,
          projectId,
        }),
      });

      if (status === 409) {
        return { conflict: true, body: data };
      }
      if (!ok) {
        throw new Error(data.error || `Commit failed (${status})`);
      }
      return {
        conflict: false,
        newCommitSha: data.newCommitSha,
        rebased: Boolean(data.rebased),
      };
    }
  }

  global.GitSyncClient = GitSyncClient;
})(window);
