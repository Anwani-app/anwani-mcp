'use strict';

import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import {
  AUTHORIZE_PAGE,
  CLIENT_ID,
  CONFIG_DIR,
  LEGACY_PKCE_PATH,
  LEGACY_TOKEN_PATH,
  MCP_URL,
  PKCE_PATH,
  REDIRECT_URI,
  SCOPES,
  TOKEN_PATH,
  TOKEN_URL,
} from './config.mjs';

export function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function sha256Base64Url(value) {
  return base64Url(createHash('sha256').update(String(value), 'utf8').digest());
}

export function newPkce() {
  const verifier = base64Url(randomBytes(32));
  const challenge = sha256Base64Url(verifier);
  const state = base64Url(randomBytes(16));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl({ challenge, state, redirectUri }) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri || REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_PAGE}?${q.toString()}`;
}

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    await chmod(CONFIG_DIR, 0o700);
  } catch {
    /* Windows may ignore mode */
  }
}

export async function saveJson(filePath, data) {
  await ensureConfigDir();
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await chmod(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

export async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function migrateLegacy(legacyPath, nextPath) {
  const legacy = await loadJson(legacyPath);
  if (!legacy) return null;
  const existing = await loadJson(nextPath);
  if (!existing) {
    await saveJson(nextPath, legacy);
  }
  try {
    await unlink(legacyPath);
  } catch {
    /* ignore */
  }
  return existing || legacy;
}

export async function savePkce(session) {
  await saveJson(PKCE_PATH, session);
}

export async function loadPkce() {
  const current = await loadJson(PKCE_PATH);
  if (current) return current;
  return migrateLegacy(LEGACY_PKCE_PATH, PKCE_PATH);
}

export async function clearPkce() {
  for (const p of [PKCE_PATH, LEGACY_PKCE_PATH]) {
    try {
      await unlink(p);
    } catch {
      /* ignore */
    }
  }
}

export async function saveToken(pack) {
  await saveJson(TOKEN_PATH, {
    access_token: pack.access_token,
    token_type: pack.token_type || 'Bearer',
    expires_in: pack.expires_in,
    scope: pack.scope,
    obtained_at: Date.now(),
  });
}

export async function loadToken() {
  const current = await loadJson(TOKEN_PATH);
  if (current?.access_token) return current;
  const migrated = await migrateLegacy(LEGACY_TOKEN_PATH, TOKEN_PATH);
  if (migrated?.access_token) return migrated;
  return null;
}

export async function exchangeCode({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri || REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const msg =
      json.error_description || json.error || `token HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function mcpCall(accessToken, payload) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const err = new Error(json.error || `mcp HTTP ${res.status}`);
    err.code = json.code;
    err.payload = json;
    throw err;
  }
  return json;
}

/** Strip internal identity — agent must not see Firebase UID. */
export function publicSessionView(session) {
  return {
    ok: true,
    connected: true,
    scopes: session.scopes || [],
    expiresAt: session.expiresAt || null,
  };
}

/** Defensive strip for list/create payloads (server should already omit these). */
export function stripAgentPayload(value) {
  if (Array.isArray(value)) {
    return value.map(stripAgentPayload);
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'sessionId' || k === 'userId' || k === 'photoPath') continue;
    out[k] = stripAgentPayload(v);
  }
  return out;
}
