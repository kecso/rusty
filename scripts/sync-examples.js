#!/usr/bin/env node
"use strict";

/**
 * Materialize runnable standalone Rust crates under `examples/` from the
 * canonical example models in `src/common/rustContract.js`.
 *
 * Usage: npm run sync:examples
 */

const fs = require("fs");
const path = require("path");
const { getStarterBlinkyModel, getSmartThermostatModel } = require("../src/common/rustContract");
const { generateCrateFiles } = require("../src/common/rustCodegen");

const REPO_ROOT = path.resolve(__dirname, "..");
const EXAMPLES_DIR = path.join(REPO_ROOT, "examples");

const EXAMPLES = [
  {
    dirName: "blinky",
    model: getStarterBlinkyModel(),
  },
  {
    dirName: "smart-thermostat",
    model: getSmartThermostatModel(),
  },
];

function writeCrate(targetDir, files) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
}

function main() {
  fs.mkdirSync(EXAMPLES_DIR, { recursive: true });

  for (const ex of EXAMPLES) {
    const targetDir = path.join(EXAMPLES_DIR, ex.dirName);
    const files = generateCrateFiles(ex.model);
    writeCrate(targetDir, files);
    console.log(`Synced examples/${ex.dirName} (${Object.keys(files).length} files)`);
  }

  const readme = `# Rusty Tutorial Examples

Self-contained, runnable Rust state-machine crates synchronized with Rusty Studio's \`RustySeed.webgmex\` and pre-configured for the \`dev\` sandbox branch of **your own fork** (\`<your-username>/rusty\`).

| Directory | StateMachine | Highlights |
| --- | --- | --- |
| [\`blinky/\`](./blinky) | \`BlinkyController\` | Hello-world GPIO blink loop, Entry/Exit hooks, mutually exclusive thermal guard, \`Fault\` / \`Reset\` |
| [\`smart-thermostat/\`](./smart-thermostat) | \`SmartThermostat\` | Model-driven HVAC controller: \`f64\` physics in self-transition actions, payload events (\`SetTarget:26.0\`, \`SetAmbient:35.0\`), domain bounds, and proven mutually exclusive guards |

## Why Fork & Use a \`dev\` Branch?

In \`RustySeed.webgmex\`, both models already have their repository name, branch, and machine-level crate directory pre-filled:
- \`gitOwner\`: \`""\` *(click **Connect Git Repository…** in Studio once to connect \`<your-username>\`)*
- \`gitRepo\`: \`rusty\`
- \`gitBranch\`: \`dev\`
- \`gitPath\` (on \`StateMachine\`): \`examples/<name>\` *(states resolve automatically to \`<dir>/src/states/<state>.rs\`)*

By forking \`kecso/rusty\` and creating a \`dev\` branch in your fork, you can safely test **Pull from GitHub**, live **Monaco editing**, **Commit & Push (\`⌘S\`)**, **auto-rebase**, and **HTTP 409 3-way merge** without touching \`main\` or needing push access to upstream.

## Running Natively with Cargo

\`\`\`bash
# Test and run SmartThermostat natively
cd examples/smart-thermostat
cargo test
cargo run -- SetTarget:26.0 Tick Tick Tick ToggleEco Tick EmergencyShutoff Reset
\`\`\`

To regenerate these directories from \`src/common/rustContract.js\`:

\`\`\`bash
npm run sync:examples
\`\`\`
`;
  fs.writeFileSync(path.join(EXAMPLES_DIR, "README.md"), readme, "utf8");
  console.log("Wrote examples/README.md");
}

main();
