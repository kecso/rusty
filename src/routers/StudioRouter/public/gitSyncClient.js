(function (global) {
  "use strict";

  /**
   * Client wrapper for `webgme-git` mounted at `/routers/gitrouter`.
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
