'use strict';

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Registered OAuth client (native public). */
export const CLIENT_ID = 'anwani-cursor';

/** Preferred loopback port; login falls back to 8787 if busy. */
export const LOOPBACK_PORTS = Object.freeze([8733, 8787]);

export function loopbackRedirectUri(port) {
  return `http://127.0.0.1:${port}/callback`;
}

/** Default product redirect — local bridge captures the code (no paste). */
export const REDIRECT_URI = loopbackRedirectUri(LOOPBACK_PORTS[0]);

/** HTTPS fallback for --paste mode only. */
export const SITE_REDIRECT_URI = 'https://9code.app/oauth/callback';

/** Authorize host must match Firebase authDomain (Google sign-in). */
export const AUTHORIZE_PAGE = 'https://nine-code-anwani.web.app/authorize';
export const TOKEN_URL =
  'https://us-central1-nine-code-anwani.cloudfunctions.net/oauthToken';
export const MCP_URL =
  'https://us-central1-nine-code-anwani.cloudfunctions.net/mcpApi';
export const SCOPES = [
  'address:read',
  'address:create',
  'address:update',
  'address:share',
  'address:delete',
].join(' ');

/** Prefer OS config dir so package updates never ship/overwrite tokens. */
export const CONFIG_DIR = path.join(os.homedir(), '.anwani-mcp');
export const TOKEN_PATH = path.join(CONFIG_DIR, 'token.json');
export const PKCE_PATH = path.join(CONFIG_DIR, 'pkce-session.json');

/** Legacy paths inside the package dir (migrated on first read). */
export const LEGACY_TOKEN_PATH = path.join(__dirname, '.token.json');
export const LEGACY_PKCE_PATH = path.join(__dirname, '.pkce-session.json');

export const PACKAGE_ROOT = __dirname;
