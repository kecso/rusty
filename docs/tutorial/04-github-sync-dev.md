# Tutorial 3: GitHub Sync on Your Fork & Directory Import

Both `BlinkyController` and `SmartThermostat` configure `GitArtifactLink` at the **`StateMachine` directory level** (`gitRepo = rusty`, `gitBranch = dev`, `gitPath = examples/<name>`), with `gitOwner` left blank so every reader connects **their own fork** (`<your-username>/rusty`) once. Once connected, individual states inherit `<machine_dir>/src/states/<state>.rs` cleanly without unbinding or per-state setup.

![Generated crate preview and one-time Connect Git Repository modal](/images/demo-generated-crate.gif)

## 1. Fork `kecso/rusty` & Create a `dev` Branch

```bash
git clone https://github.com/<your-username>/rusty.git
cd rusty
git checkout -b dev
git push -u origin dev
```

## 2. Configure GitHub App Credentials

Follow [`webgme-git/docs/setup-github-app.md`](https://github.com/kecso/webgme-git/blob/main/docs/setup-github-app.md) to set up a GitHub App (callback URL: `http://127.0.0.1:8888/auth/github/callback`, Contents: Read & write) installed on **`<your-username>/rusty`**, then configure `rusty/.env`:

```bash
cp .env.example .env
openssl rand -hex 32   # paste into TOKEN_ENCRYPTION_KEY
```

```ini
RUSTY_AUTH=true
GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/app.private-key.pem
TOKEN_ENCRYPTION_KEY=...
```

Restart `npm start`.

## 3. Connect Your Machine Directory Once (`<your-username>/rusty@dev`)

1. Sign in at `http://127.0.0.1:8888/profile/login`, open **User Profile** (`/profile`) in Studio's top bar, and link **`<your-username>/rusty`** (`read-write`) to `RustyDemo`.
2. Open `http://127.0.0.1:8888/routers/studio` (`GitHub: @<your-login>`).
3. Click **`Connect Git Repository…`** in the Git Repository bar:
   - **Owner**: `<your-username>`
   - **Repo**: `rusty`
   - **Branch**: `dev`
   - **Machine Directory**: `examples/smart-thermostat`
   - Choose **Connect current design** and click **Connect Repository**.
4. Once connected, the Git Repository bar displays your read-only repository target (`<your-username>/rusty@dev · examples/smart-thermostat`), and every State inspector resolves directly to `<dir>/src/states/<state>.rs`.

## 4. Edit-Fetch-Commit-Push (`⌘S`), Auto-Rebase & HTTP 409

- **Auto-Fetch**: Opening a State fetches its live `.rs` file from GitHub into Monaco. Because files live in standard Git paths, you can also edit them directly in VS Code, Neovim, or CI outside the web UI.
- **Continuous Save & Push (`⌘S`)**: Pressing **`⌘S`** (or clicking **`↑ Save & Push`**) updates WebGME's `codeCache` + `dependsOn` Set and commits atomically to `<your-username>/rusty@dev` via Octokit.
- **Transparent Auto-Rebase vs. HTTP 409**: Commits to another file rebase automatically; conflicting edits on the same file open Rusty Studio's **3-Way Merge Conflict** modal.

## 5. Import an Existing Rust Machine During Initial Connection

When setting up a **new machine** from existing Rust source files on GitHub, you can import and connect in one step:

1. Create a new local draft machine via **`+ Machine`** (or select any not-yet-connected machine).
2. Click **`Connect Git Repository…`**.
3. Enter **Owner**, **Repo**, **Branch**, and **Machine Directory** (for example `examples/smart-thermostat` or your own crate path).
4. Select **Connect & import existing Rust code (one-time)** and click **Connect & Import**:
   - Rusty sweeps `Cargo.toml`, `src/types.rs`, `src/machine.rs`, and `src/states/*.rs` (or infers types directly from standalone `*.rs` files).
   - It populates your `StateMachine` with `States`, `GlobalVars`, `EventDefs`, guarded `Transitions`, clean fixed-layout positions, and `dependsOn` Sets—connected directly to that directory for ongoing editing!
5. *(For batch automation or generic WebGME admin workflows, the **`Import StateMachine from GitHub Directory`** (`ImportFromGitHub`) plugin is also available in dev mode.)*

## 6. Resetting Your Fork's `dev` Branch

```bash
git fetch origin
git push origin origin/main:dev --force-with-lease
```
