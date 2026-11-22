# Tutorial 4: Testing GitHub Sync on the `dev` Branch

Both `BlinkyController` and `SmartThermostat` in `RustySeed.webgmex` point to the **`dev`** branch of `kecso/rusty` so you can freely test real `webgme-git` OAuth, auto-fetch, commit+push, auto-rebase, and 3-way merge conflict resolution without risking `main`.

## 1. Configure GitHub App Credentials

Follow [`webgme-git/docs/setup-github-app.md`](https://github.com/kecso/webgme-git/blob/main/docs/setup-github-app.md) to create/reuse your GitHub App (callback URL: `http://127.0.0.1:8888/auth/github/callback`, Contents: Read & write), then configure `rusty/.env`:

```bash
cp .env.example .env
openssl rand -hex 32   # paste into TOKEN_ENCRYPTION_KEY
```

Set in `.env`:

```ini
RUSTY_AUTH=true
GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/app.private-key.pem
TOKEN_ENCRYPTION_KEY=...
```

Restart `npm start`.

## 2. Sign In & Authorize the Repo via `/profile`

1. Visit `http://127.0.0.1:8888/profile/login` and sign in with GitHub.
2. Open your project (`RustyDemo`) in `/profile` and ensure `kecso/rusty` is linked with `read-write` access.
3. Open `http://127.0.0.1:8888/routers/studio` — the top-right badge now reads **`GitHub: @<your-login>`**.

## 3. Auto-Fetch on Open + Combined Commit & Push (`⌘S`)

1. Switch **Machine** to **`SmartThermostat`** and click **`Standby`**.
2. Notice **`Fetching from GitHub…`** → **`Loaded from GitHub`**: Studio automatically called `GET /routers/gitrouter/tree` (Octokit) for `examples/smart-thermostat/src/states/standby.rs` on branch `dev` and filled Monaco with the live GitHub file.
3. Add a harmless comment or adjust a constant in `standby.rs`. Notice the dot turns yellow (`Modified (unsynced)`).
4. Press **`⌘S`** (or **`Ctrl+S`**, or click **↑ Commit & Push (⌘S)**).
   - Studio saves `codeCache` to WebGME, runs `RustyAnalyzer`, calls `POST /routers/gitrouter/commit` via Octokit, pushes the commit directly to `dev`, and stores the returned `newCommitSha` back onto the WebGME `State` node's `gitBaseCommitSha`!

## 4. Test Transparent Auto-Rebase & HTTP 409 Conflict Resolution

- **Auto-rebase**: While keeping `standby.rs` open in Studio, commit a change to a *different* file (like `cooling.rs`) on `dev` via GitHub or CLI. Now edit `standby.rs` in Studio and press `⌘S` — `webgme-git` rebases transparently onto the new `HEAD` and shows a toast (`Committed <sha> (transparently rebased over upstream changes!)`).
- **3-way conflict (HTTP 409)**: Edit the *same* file (`standby.rs`) directly on GitHub `dev`, then edit conflicting lines in Studio and press `⌘S`. `webgme-git` detects the collision and opens Rusty Studio's **3-Way Merge Conflict** modal showing **Base**, **Upstream**, and **Local** panes side by side so you can resolve and re-commit.

## 5. Resetting `dev` Back to `main`

Whenever you want a clean slate on `dev`:

```bash
git fetch origin
git push origin origin/main:dev --force-with-lease
```
