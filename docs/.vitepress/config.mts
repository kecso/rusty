import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Rusty Studio",
  description:
    "WebGME + webgme-git Rust State Machine Modeling, Edit-Time Analysis, and Dynamic Simulation Studio",
  base: process.env.DOCS_BASE || "/",
  cleanUrls: false,
  themeConfig: {
    siteTitle: "🦀 Rusty Studio",
    search: {
      provider: "local",
    },
    nav: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "Tutorials", link: "/tutorial/01-blinky-quickstart" },
      { text: "SmartThermostat", link: "/tutorial/02-smart-thermostat" },
      { text: "Reference", link: "/reference/metamodel" },
      { text: "GitHub", link: "https://github.com/kecso/rusty" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Project Vision", link: "/VISION" },
        ],
      },
      {
        text: "Core Concepts",
        items: [
          { text: "WebGME + Git Architecture", link: "/concepts/architecture" },
          { text: "Rust State Contract", link: "/concepts/state-contract" },
          { text: "webgme-git & dev Branch Sync", link: "/concepts/git-workflow" },
        ],
      },
      {
        text: "Step-by-Step Tutorials",
        items: [
          { text: "1. Blinky Quickstart", link: "/tutorial/01-blinky-quickstart" },
          { text: "2. SmartThermostat (Full Showcase)", link: "/tutorial/02-smart-thermostat" },
          { text: "3. Edit-Time Checks in Monaco", link: "/tutorial/03-edit-time-checks" },
          { text: "4. Testing GitHub Sync on dev", link: "/tutorial/04-github-sync-dev" },
          { text: "5. Codegen & Native Cargo Run", link: "/tutorial/05-codegen-and-native" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "WebGME Metamodel", link: "/reference/metamodel" },
          { text: "Edit-Time Diagnostics", link: "/reference/diagnostics" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/kecso/rusty" },
    ],
    footer: {
      message: "Built on WebGME & webgme-git · MIT License",
      copyright: "Rusty State Machine Studio",
    },
  },
});
