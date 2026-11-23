# Tutorial 3: GitHub Sync on Your Fork & Directory Import

Both `BlinkyController` and `SmartThermostat` bind Git at the **`StateMachine` directory level** (`gitRepo = rusty`, `gitBranch = dev`, `gitPath = examples/<name>`), with `gitOwner` left blank so every reader binds **their own fork** (`<your-username>/rusty`). Individual states inherit `<machine_dir>/src/states/<state>.rs` cleanly and can still override their Git path on a per-state basis if desired.

![Generated crate preview, Bind Machine Directory modal, and Import from GitHub modal](/images/demo-generated-crate.gif)

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

## 3. Bind Your Machine Directory (`<your-username>/rusty@dev`)

1. Sign in at `http://127.0.0.1:8888/profile/login` and link **`<your-username>/rusty`** (`read-write`) to `RustyDemo`.
2. Open `http://127.0.0.1:8888/routers/studio` (`GitHub: @<your-login>`).
3. Click **`Bind GitHub Repo…`**:
   - **Owner**: `<your-username>`
   - **Repo**: `rusty`
   - **Branch**: `dev`
   - **Machine Directory**: `examples/smart-thermostat`
4. Notice the **Effective Path** badge in every State inspector updates cleanly to `<dir>/src/states/<state>.rs` (with an optional **Override Git path / repo for this state** drawer underneath if a single file lives elsewhere).

## 4. Edit-Fetch-Commit-Push (`⌘S`), Auto-Rebase & HTTP 409

- **Auto-Fetch**: Opening a State fetches its live `.rs` file from GitHub into Monaco. Because files live in standard Git paths, you can also edit them directly in VS Code, Neovim, or CI outside the web UI.
- **Combined Commit & Push (`⌘S`)**: Updates `codeCache` and WebGME's `dependsOn` Set, then commits atomically to `<your-username>/rusty@dev` via Octokit.
- **Transparent Auto-Rebase vs. HTTP 409**: Commits to another file rebase automatically; conflicting edits on the same file open Rusty Studio's **3-Way Merge Conflict** modal.

## 5. Import an Existing Rust Machine from a GitHub Directory

Because a machine maps cleanly to a GitHub directory, you can also go in reverse—**rebuilding a full WebGME design directly from code on GitHub**:

1. Click **`↓ Import from GitHub…`** in Rusty Studio's Git Repository bar (or run the **`Import StateMachine from GitHub Directory`** plugin from stock WebGME UI).
2. Enter **Owner**, **Repo**, **Branch**, and **Directory Path** (or click **`Preset: SmartThermostat`** / **`Preset: Blinky`**).
3. Click **`Sweep & Import StateMachine`**:
   - Rusty sweeps `Cargo.toml`, `src/types.rs`, `src/machine.rs`, and `src/states/*.rs` (or infers types directly from standalone `*.rs` files).
   - It creates a complete WebGME `StateMachine` with `States`, `GlobalVars`, `EventDefs`, guarded `Transitions`, clean fixed-layout positions, and populated `dependsOn` Sets—ready to edit visually or simulate immediately!

## 6. Resetting Your Fork's `dev` Branch

```bash
git fetch origin
git push origin origin/main:dev --force-with-lease
```
