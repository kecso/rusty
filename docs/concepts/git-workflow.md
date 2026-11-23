# `webgme-git` & `dev` Branch Sync Workflow

Rusty serves as the reference showcase for [`webgme-git`](https://github.com/kecso/webgme-git). Instead of storing canonical Rust code inside WebGME blobs, WebGME stores a **`GitArtifactLink`** mixin pointing to GitHub.

## 1. The `GitArtifactLink` Mixin

Both `StateMachine` and `State` inherit attributes from the abstract `GitArtifactLink` meta-node:

| Attribute | Meaning on `StateMachine` | Meaning on `State` |
| --- | --- | --- |
| `gitOwner` | Repository owner (e.g. `<your-username>` via **Connect Git Repository…**) | Inherited from machine |
| `gitRepo` | Repository name (e.g. `rusty`) | Repository name |
| `gitBranch` | Target branch (e.g. `dev`) | Target branch |
| `gitPath` | Crate/states directory (e.g. `examples/smart-thermostat`) | Derived automatically as `<machine_dir>/src/states/<state>.rs` |
| `gitArtifactType` | `dir` | `file` |
| `gitBaseCommitSha` | — | Last synced Git commit SHA (updated automatically on commit) |

## 2. How Edit-Fetch-Commit-Push Works

1. **Auto-Fetch on State Open**: When you select a `State` in Rusty Studio while signed into GitHub, `selectStateForEditing` calls `GET /routers/gitrouter/tree` (powered by Octokit on the WebGME server) and populates Monaco with the live file from GitHub.
2. **Edit & Instant Check**: As you type, `RustyAnalyzer` checks your changes locally in `< 1 ms`. WebGME marks the state dot yellow (`Modified (unsynced)`).
3. **Combined Save & Push (`⌘S` / `Ctrl+S`)**: Pressing `⌘S` (or clicking **Save & Push (⌘S)**) saves `codeCache` inside WebGME and calls `POST /routers/gitrouter/commit` with `expectedParentSha = gitBaseCommitSha`.
4. **Transparent Auto-Rebase vs. HTTP 409 Conflict**:
   - If another collaborator committed to a **different file** on the same branch while you were editing, `webgme-git` automatically performs a tree-level rebase and returns `{ newCommitSha, rebased: true }` with a warning toast.
   - If another collaborator modified the **same file** (`heating.rs`), `webgme-git` returns `HTTP 409` with `{ currentHeadSha, conflicts: [{ path, base, upstream, local }] }`, opening Rusty Studio's **3-Way Merge Conflict Resolver** modal so you can inspect Base / Upstream / Local and commit the merged file.
5. **SHA Persistence**: On any successful commit, Rusty Studio writes `newCommitSha` back to `gitBaseCommitSha` inside a WebGME transaction so the model always knows which Git revision it matches.
