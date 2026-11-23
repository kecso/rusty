/* eslint-env node */
"use strict";

/**
 * Layer 1 WebGME OAuth 2.0 / OIDC configuration helper for Rusty.
 *
 * Maps `OAUTH_*` and `RUSTY_*` environment variables onto `webgme-engine`'s
 * `config.authentication.oauth`, `allowPasswordLogin`, and `enableAccessTokens`.
 * Supports built-in GitHub & Google presets as well as any custom OIDC/OAuth IdP.
 */

function parseScopes(raw, fallback) {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  const list = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

/**
 * Determine whether Layer 1 OAuth environment variables are sufficiently configured.
 *
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
function hasOAuthEnv(env = process.env) {
  const clientId = env && typeof env.OAUTH_CLIENT_ID === "string" ? env.OAUTH_CLIENT_ID.trim() : "";
  if (!clientId) {
    return false;
  }
  const provider = env && typeof env.OAUTH_PROVIDER === "string" ? env.OAUTH_PROVIDER.trim().toLowerCase() : "";
  const discoveryUrl = env && typeof env.OAUTH_DISCOVERY_URL === "string" ? env.OAUTH_DISCOVERY_URL.trim() : "";
  const authUrl = env && typeof env.OAUTH_AUTHORIZATION_URL === "string" ? env.OAUTH_AUTHORIZATION_URL.trim() : "";
  const tokenUrl = env && typeof env.OAUTH_TOKEN_URL === "string" ? env.OAUTH_TOKEN_URL.trim() : "";

  return (
    provider === "github" ||
    provider === "google" ||
    Boolean(discoveryUrl) ||
    Boolean(authUrl && tokenUrl)
  );
}

/**
 * Configure `config.authentication.oauth`, `allowPasswordLogin`, and
 * `enableAccessTokens` on a WebGME config object from environment variables.
 *
 * @param {object} config
 * @param {object} [env=process.env]
 * @returns {object} mutated config
 */
function configureLayer1OAuth(config, env = process.env) {
  if (!config || typeof config !== "object") {
    throw new Error("config object is required for configureLayer1OAuth");
  }

  config.authentication = config.authentication || {};
  const defaults = config.authentication.oauth || {};
  const sourceEnv = env || {};

  const port = (config.server && config.server.port) || 8888;
  const baseOrigin = String(sourceEnv.WEBGME_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  const defaultRedirectUri = `${baseOrigin}/oauth/callback`;
  const redirectUri =
    sourceEnv.OAUTH_REDIRECT_URI && sourceEnv.OAUTH_REDIRECT_URI.trim()
      ? sourceEnv.OAUTH_REDIRECT_URI.trim()
      : defaultRedirectUri;

  const rawProvider = typeof sourceEnv.OAUTH_PROVIDER === "string" ? sourceEnv.OAUTH_PROVIDER.trim() : "";
  const providerKey = rawProvider.toLowerCase();

  let oauth = {
    ...defaults,
    claims: { ...(defaults.claims || {}) },
    extraAuthorizeParams: { ...(defaults.extraAuthorizeParams || {}) },
    autoCreateUser: true,
    usersCanCreate: true,
  };

  if (!hasOAuthEnv(sourceEnv)) {
    oauth.enable = false;
  } else if (providerKey === "github") {
    oauth = {
      ...oauth,
      enable: true,
      providerName: sourceEnv.OAUTH_PROVIDER_NAME || "github",
      discoveryUrl: sourceEnv.OAUTH_DISCOVERY_URL || null,
      authorizationUrl: sourceEnv.OAUTH_AUTHORIZATION_URL || "https://github.com/login/oauth/authorize",
      tokenUrl: sourceEnv.OAUTH_TOKEN_URL || "https://github.com/login/oauth/access_token",
      userInfoUrl: sourceEnv.OAUTH_USERINFO_URL || "https://api.github.com/user",
      endSessionUrl: null,
      clientId: sourceEnv.OAUTH_CLIENT_ID.trim(),
      clientSecret: sourceEnv.OAUTH_CLIENT_SECRET || null,
      redirectUri,
      scopes: parseScopes(sourceEnv.OAUTH_SCOPES, ["read:user", "user:email"]),
      usePKCE: sourceEnv.OAUTH_USE_PKCE !== undefined ? sourceEnv.OAUTH_USE_PKCE === "true" : false,
      tokenRoute: null,
      claims: {
        subject: "id",
        username: "login",
        email: "email",
        displayName: "name",
      },
      userIdPrefix: sourceEnv.OAUTH_USER_ID_PREFIX !== undefined ? sourceEnv.OAUTH_USER_ID_PREFIX : "gh_",
    };
  } else if (providerKey === "google") {
    oauth = {
      ...oauth,
      enable: true,
      providerName: sourceEnv.OAUTH_PROVIDER_NAME || "google",
      discoveryUrl:
        sourceEnv.OAUTH_DISCOVERY_URL || "https://accounts.google.com/.well-known/openid-configuration",
      authorizationUrl: sourceEnv.OAUTH_AUTHORIZATION_URL || null,
      tokenUrl: sourceEnv.OAUTH_TOKEN_URL || null,
      userInfoUrl: sourceEnv.OAUTH_USERINFO_URL || null,
      clientId: sourceEnv.OAUTH_CLIENT_ID.trim(),
      clientSecret: sourceEnv.OAUTH_CLIENT_SECRET || null,
      redirectUri,
      scopes: parseScopes(sourceEnv.OAUTH_SCOPES, ["openid", "profile", "email"]),
      usePKCE: sourceEnv.OAUTH_USE_PKCE !== undefined ? sourceEnv.OAUTH_USE_PKCE === "true" : true,
      tokenRoute: defaults.tokenRoute !== undefined ? defaults.tokenRoute : "/oauth/token",
      claims: {
        subject: "sub",
        username: "email",
        email: "email",
        displayName: "name",
      },
      userIdPrefix: sourceEnv.OAUTH_USER_ID_PREFIX !== undefined ? sourceEnv.OAUTH_USER_ID_PREFIX : "google_",
      extraAuthorizeParams: {
        ...oauth.extraAuthorizeParams,
        prompt: "select_account",
      },
    };
  } else {
    oauth = {
      ...oauth,
      enable: true,
      providerName: sourceEnv.OAUTH_PROVIDER_NAME || rawProvider || defaults.providerName || "oauth",
      discoveryUrl: sourceEnv.OAUTH_DISCOVERY_URL || null,
      authorizationUrl: sourceEnv.OAUTH_AUTHORIZATION_URL || null,
      tokenUrl: sourceEnv.OAUTH_TOKEN_URL || null,
      userInfoUrl: sourceEnv.OAUTH_USERINFO_URL || null,
      clientId: sourceEnv.OAUTH_CLIENT_ID.trim(),
      clientSecret: sourceEnv.OAUTH_CLIENT_SECRET || null,
      redirectUri,
      scopes: parseScopes(sourceEnv.OAUTH_SCOPES, defaults.scopes || ["openid", "profile", "email"]),
      usePKCE: sourceEnv.OAUTH_USE_PKCE !== undefined ? sourceEnv.OAUTH_USE_PKCE === "true" : true,
      userIdPrefix:
        sourceEnv.OAUTH_USER_ID_PREFIX !== undefined
          ? sourceEnv.OAUTH_USER_ID_PREFIX
          : defaults.userIdPrefix || "oauth_",
    };
  }

  config.authentication.oauth = oauth;

  if (sourceEnv.RUSTY_ALLOW_PASSWORD_LOGIN === "true") {
    config.authentication.allowPasswordLogin = true;
  } else if (sourceEnv.RUSTY_ALLOW_PASSWORD_LOGIN === "false") {
    config.authentication.allowPasswordLogin = false;
  } else {
    config.authentication.allowPasswordLogin = !config.authentication.oauth.enable;
  }

  config.authentication.enableAccessTokens = sourceEnv.RUSTY_ENABLE_ACCESS_TOKENS !== "false";

  return config;
}

module.exports = {
  configureLayer1OAuth,
  hasOAuthEnv,
};
