import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE || "/";

export default defineConfig({
  title: "Rusty Studio",
  description:
    "Visual state machine design with Git-backed Rust state code, continuous edit-time checks, design-impact tracking, and standalone Cargo crates.",
  base,
  cleanUrls: false,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }]],
  themeConfig: {
    siteTitle: "Rusty Studio",
    logo: "/logo.svg",
    search: {
      provider: "local",
    },
    nav: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "Counter Tutorial", link: "/tutorial/00-build-a-counter" },
      { text: "Demo Showcases", link: "/tutorial/02-smart-thermostat" },
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
        text: "Step-by-Step Tutorial",
        items: [
          { text: "1. Build a Simple Counter", link: "/tutorial/00-build-a-counter" },
          { text: "2. Edit-Time & Impact Checks", link: "/tutorial/03-edit-time-checks" },
          { text: "3. GitHub Sync & Import", link: "/tutorial/04-github-sync-dev" },
          { text: "4. Standalone Rust Crates", link: "/tutorial/05-codegen-and-native" },
        ],
      },
      {
        text: "Demo Showcases",
        items: [
          { text: "BlinkyController Showcase", link: "/tutorial/01-blinky-quickstart" },
          { text: "SmartThermostat Showcase", link: "/tutorial/02-smart-thermostat" },
        ],
      },
      {
        text: "Concepts & Reference",
        items: [
          { text: "WebGME + Git Architecture", link: "/concepts/architecture" },
          { text: "Model-Driven Architecture & Guards", link: "/concepts/model-driven-architecture" },
          { text: "Rust State Contract", link: "/concepts/state-contract" },
          { text: "Fork & Dev Branch Sync", link: "/concepts/git-workflow" },
          { text: "WebGME Metamodel", link: "/reference/metamodel" },
          { text: "Edit-Time & Impact Diagnostics", link: "/reference/diagnostics" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/kecso/rusty" }],
    footer: {
      message: "Built on WebGME & webgme-git · MIT License",
      copyright: "Rusty State Machine Studio",
    },
  },
});
