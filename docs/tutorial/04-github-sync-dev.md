# Tutorial 4: Testing GitHub Sync on Your Fork's `dev` Branch

Both `BlinkyController` and `SmartThermostat` in `RustySeed.webgmex` point `gitRepo` to `rusty` and `gitBranch` to **`dev`**, with `gitOwner` left blank so every reader binds **their own fork** (`<your-username>/rusty`). That way you can freely test real `webgme-git` OAuth, auto-fetch, commit+push, auto-rebase, and 3-way merge conflict resolution without needing push permissions on `kecso/rusty` or touching `main`.

## 1. Fork `kecso/rusty` & Create a `dev` Branch

If you have not already forked the repository:

1. Fork [`https://github.com/kecso/rusty`](https://github.com/kecso/rusty) into your own GitHub account (`<your-username>/rusty`).
2. Ensure your fork has a **`dev`** branch matching `main`:

```bash
git clone https://github.com/<your-username>/rusty.git
cd rusty
git checkout -b dev
git push -u origin dev
```

## 2. Configure GitHub App Credentials

Follow [`webgme-git/docs/setup-github-app.md`](https://github.com/kecso/webgme-git/blob/main/docs/setup-github-app.md) to create/reuse your GitHub App (callback URL: `http://127.0.0.1:8888/auth/github/callback`, Contents: Read & write) and install it on **`<your-username>/rusty`**, then configure `rusty/.env`:

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

## 3. Sign In, Link Your Fork in `/profile`, and Bind in Studio

1. Visit `http://127.0.0.1:8888/profile/login` and sign in with GitHub.
2. Open your project (`RustyDemo`) in `/profile` and ensure **`<your-username>/rusty`** is linked with `read-write` access.
3. Open `http://127.0.0.1:8888/routers/studio` — the top-right badge now reads **`GitHub: @<your-login>`**.
4. Click **Bind GitHub Repo…** in the `GitArtifactLink` bar, enter:
   - **Owner**: `<your-username>`
   - **Repo**: `rusty`
   - **Branch**: `dev`
   and save (applies cleanly to both `StateMachine` and all `State` nodes).

## 4. Auto-Fetch on Open + Combined Commit & Push (`⌘S`)

1. Switch **Machine** to **`SmartThermostat`** and click **`Standby`**.
2. Notice **`Fetching from GitHub…`** → **`Loaded from GitHub`**: Studio automatically called `GET /routers/gitrouter/tree` (Octokit) for `examples/smart-thermostat/src/states/standby.rs` on your fork's `dev` branch and filled Monaco with the live GitHub file.
3. Add a harmless comment or adjust a constant in `standby.rs`. Notice the dot turns yellow (`Modified (unsynced)`).
4. Press **`⌘S`** (or **`Ctrl+S`**, or click **↑ Commit & Push (⌘S)**).
   - Studio saves `codeCache` to WebGME, runs `RustyAnalyzer`, calls `POST /routers/gitrouter/commit` via Octokit, pushes the commit directly to `<your-username>/rusty@dev`, and stores the returned `newCommitSha` back onto the WebGME `State` node's `gitBaseCommitSha`!

## 5. Test Transparent Auto-Rebase & HTTP 409 Conflict Resolution

- **Auto-rebase**: While keeping `standby.rs` open in Studio, commit a change to a *different* file (like `cooling.rs`) on your fork's `dev` branch via GitHub or CLI. Now edit `standby.rs` in Studio and press `⌘S` — `webgme-git` rebases transparently onto the new `HEAD` and shows a toast (`Committed <sha> (transparently rebased over upstream changes!)`).
- **3-way conflict (HTTP 409)**: Edit the *same* file (`standby.rs`) directly on `<your-username>/rusty` branch `dev`, then edit conflicting lines in Studio and press `⌘S`. `webgme-git` detects the collision and opens Rusty Studio's **3-Way Merge Conflict** modal showing **Base**, **Upstream**, and **Local** panes side by side so you can resolve and re-commit.

## 6. Resetting Your Fork's `dev` Branch Back to `main`

Whenever you want a clean slate on your fork's `dev` branch:

```bash
git fetch origin
git push origin origin/main:dev --force-with-lease
```
