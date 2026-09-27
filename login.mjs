#!/usr/bin/env node
'use strict';

/**
 * Cursor ↔ Anwani OAuth login (PKCE).
 *
 * Default: loopback capture (open browser → Google → Allow → connected).
 * Fallback: --paste (HTTPS callback page + paste JSON) for constrained environments.
 *
 * Usage:
 *   node login.mjs
 *   node login.mjs --paste
 *   node login.mjs --url-only
 *   node login.mjs --code '{...}'
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  buildAuthorizeUrl,
  clearPkce,
  exchangeCode,
  loadPkce,
  newPkce,
  savePkce,
  saveToken,
} from './lib.mjs';
import {
  LOOPBACK_PORTS,
  SITE_REDIRECT_URI,
  loopbackRedirectUri,
} from './config.mjs';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const out = {
    urlOnly: false,
    paste: false,
    codeRaw: null,
    codeFile: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url-only') out.urlOnly = true;
    else if (a === '--paste') out.paste = true;
    else if (a === '--code') out.codeRaw = argv[++i] || '';
    else if (a.startsWith('--code=')) out.codeRaw = a.slice('--code='.length);
    else if (a === '--code-file') out.codeFile = argv[++i] || '';
    else if (a.startsWith('--code-file=')) {
      out.codeFile = a.slice('--code-file='.length);
    }
  }
  return out;
}

function parseCodePaste(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('empty code paste');
  if (text.startsWith('{')) {
    const j = JSON.parse(text);
    return { code: String(j.code || '').trim(), state: j.state || null };
  }
  return { code: text, state: null };
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // cmd `start` splits on `&` in query strings — breaks PKCE authorize URLs.
      spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log('Open this URL manually:');
    console.log(url);
  }
}

function successHtml() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>عنواني — تم الاتصال</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f7f5; color: #15201b;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    main { max-width: 28rem; padding: 2rem; background: #fff; border-radius: 16px;
      box-shadow: 0 8px 28px rgba(21,32,27,.08); text-align: center; }
    h1 { margin: 0 0 .5rem; font-size: 1.35rem; color: #1f4d3a; }
    p { margin: 0; line-height: 1.6; color: #4a5a52; }
  </style>
</head>
<body>
  <main>
    <h1>تم الاتصال بنجاح</h1>
    <p>يمكنك إغلاق هذه النافذة والعودة إلى كيرسر.</p>
  </main>
</body>
</html>`;
}

function errorHtml(message) {
  const safe = String(message || 'error')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>عنواني — فشل التفويض</title></head>
<body style="font-family:system-ui;padding:2rem;direction:rtl">
  <h1>فشل التفويض</h1>
  <p>${safe}</p>
</body>
</html>`;
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function startLoopbackServer() {
  let lastErr;
  for (const port of LOOPBACK_PORTS) {
    try {
      const server = await tryListen(port);
      return { server, port, redirectUri: loopbackRedirectUri(port) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('no free loopback port');
}

function waitForLoopbackCode(server, expectedState) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('login timed out — run node login.mjs again'));
    }, LOGIN_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      server.removeAllListeners('request');
    }

    server.on('request', (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        if (u.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        const error = u.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml(error));
          cleanup();
          reject(new Error(`authorization denied: ${error}`));
          return;
        }
        const code = String(u.searchParams.get('code') || '').trim();
        const state = u.searchParams.get('state');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml('missing code'));
          cleanup();
          reject(new Error('missing authorization code'));
          return;
        }
        if (expectedState && state && state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorHtml('state mismatch'));
          cleanup();
          reject(new Error('state mismatch — start login again'));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(successHtml());
        cleanup();
        resolve({ code, state });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

async function finishLogin({ code, state, pkce, redirectUri }) {
  if (!code) throw new Error('missing code');
  if (state && pkce.state && state !== pkce.state) {
    throw new Error(
      'state mismatch — this code belongs to an older login. Run login again.',
    );
  }
  const tokenPack = await exchangeCode({
    code,
    codeVerifier: pkce.verifier,
    redirectUri,
  });
  await saveToken(tokenPack);
  await clearPkce();

  console.log('');
  console.log('OK — access token saved for Cursor MCP bridge.');
  console.log(`token_type: ${tokenPack.token_type || 'Bearer'}`);
  console.log(`expires_in: ${tokenPack.expires_in}`);
  console.log(`scope: ${tokenPack.scope || '(from server)'}`);
  console.log('');
  console.log('Token stored under ~/.anwani-mcp/ (not inside the package).');
  console.log('');
  console.log('Next: enable the Anwani MCP server in Cursor, then ask it to create an address.');
}

async function loginLoopback(pkce) {
  const { server, redirectUri } = await startLoopbackServer();
  try {
    await savePkce({ ...pkce, redirectUri });
    const url = buildAuthorizeUrl({
      challenge: pkce.challenge,
      state: pkce.state,
      redirectUri,
    });
    console.log('');
    console.log('Opening browser for Anwani consent…');
    console.log('(If it does not open, use this URL:)');
    console.log(url);
    console.log('');
    console.log('Waiting for Google Allow on this machine (no paste needed)…');
    openBrowser(url);
    const { code, state } = await waitForLoopbackCode(server, pkce.state);
    await finishLogin({ code, state, pkce, redirectUri });
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function loginPaste(pkce, pasted) {
  const redirectUri = SITE_REDIRECT_URI;
  await savePkce({ ...pkce, redirectUri });
  const url = buildAuthorizeUrl({
    challenge: pkce.challenge,
    state: pkce.state,
    redirectUri,
  });

  if (!pasted) {
    console.log('');
    console.log('Paste mode — open this URL:');
    console.log(url);
    console.log('');
    console.log('After Allow, copy the JSON from the callback page and paste here.');
    console.log('');
    const rl = readline.createInterface({ input, output });
    pasted = await rl.question('Paste { "code": "...", "state": "..." }: ');
    rl.close();
  }

  const { code, state } = parseCodePaste(pasted);
  await finishLogin({ code, state, pkce, redirectUri });
}

async function main() {
  const args = parseArgs(process.argv);
  let pasted = args.codeRaw;
  if (!pasted && args.codeFile) {
    const { readFile } = await import('node:fs/promises');
    pasted = await readFile(args.codeFile, 'utf8');
  }

  let pkce = await loadPkce();
  if (!pasted && (!pkce?.verifier || !pkce?.challenge || !pkce?.state)) {
    pkce = newPkce();
    await savePkce(pkce);
  }
  if (!pkce?.verifier || !pkce?.challenge || !pkce?.state) {
    pkce = newPkce();
    await savePkce(pkce);
  }

  if (args.urlOnly) {
    const redirectUri = args.paste ? SITE_REDIRECT_URI : loopbackRedirectUri(LOOPBACK_PORTS[0]);
    await savePkce({ ...pkce, redirectUri });
    const url = buildAuthorizeUrl({
      challenge: pkce.challenge,
      state: pkce.state,
      redirectUri,
    });
    console.log(url);
    return;
  }

  if (pasted || args.paste) {
    await loginPaste(pkce, pasted);
    return;
  }

  await loginLoopback(pkce);
}

main().catch((err) => {
  console.error(`login failed: ${err.message || err}`);
  process.exitCode = 1;
});
