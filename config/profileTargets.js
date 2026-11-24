"use strict";

/**
 * Configure `/profile` quick-open link targets based on which UI routes are active
 * (dev dual UI vs. Studio-at-root hybrid vs. production Studio-only).
 */
function applyProfileOpenTargets(gmeConfig) {
  if (!gmeConfig || !gmeConfig.authentication) return gmeConfig;
  const studioOpts =
    (gmeConfig.rest &&
      gmeConfig.rest.components &&
      gmeConfig.rest.components.studio &&
      gmeConfig.rest.components.studio.options) ||
    {};
  const serveWebGMEUI = studioOpts.serveWebGMEUI !== false;
  const rootToStudio = Boolean(studioOpts.rootToStudio);

  let projectOpenTargets;
  if (!serveWebGMEUI) {
    projectOpenTargets = [{ label: "Studio", path: "/" }];
  } else if (rootToStudio) {
    projectOpenTargets = [
      { label: "Studio", path: "/" },
      { label: "WebGME", path: "/index.html" },
    ];
  } else {
    projectOpenTargets = [
      { label: "Studio", path: "/routers/studio" },
      { label: "WebGME", path: "/" },
    ];
  }

  gmeConfig.authentication.userManagementPageOptions = {
    ...(gmeConfig.authentication.userManagementPageOptions || {}),
    projectOpenTargets,
  };
  return gmeConfig;
}

module.exports = { applyProfileOpenTargets };
