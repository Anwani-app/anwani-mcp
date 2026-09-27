#!/usr/bin/env node
'use strict';

/**
 * Minimal MCP stdio bridge for Cursor → Anwani.
 * Speaks only public tools. Never exposes Firebase UID / Firestore.
 */

import readline from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  loadToken,
  mcpCall,
  publicSessionView,
  stripAgentPayload,
} from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkgVersion = '1.0.0';
try {
  pkgVersion = JSON.parse(
    readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
  ).version || pkgVersion;
} catch {
  /* ignore */
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'anwani', version: pkgVersion };

const TOOL_SCHEMAS = {
  session: {
    name: 'session',
    description:
      'Check that Anwani is connected for this user. Does not return internal IDs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  list_addresses: {
    name: 'list_addresses',
    description:
      'List addresses owned by the connected Anwani account (same quota as app/Telegram).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    scopes: ['address:read'],
  },
  create_address: {
    name: 'create_address',
    description:
      'Create one address within the user quota. Requires a real map pin from the user (latitude/longitude). NEVER invent coordinates, city, or display name. If the user did not provide a location (coords, Maps link, or clear place), ask them first — do not call this tool with sample/demo data.',
    inputSchema: {
      type: 'object',
      required: ['idempotency_key', 'latitude', 'longitude'],
      properties: {
        idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
        latitude: {
          type: 'number',
          minimum: -90,
          maximum: 90,
          description: 'User-provided latitude only — never invent.',
        },
        longitude: {
          type: 'number',
          minimum: -180,
          maximum: 180,
          description: 'User-provided longitude only — never invent.',
        },
        ownerName: {
          type: 'string',
          maxLength: 80,
          description: 'Display name only if the user provided one.',
        },
        label: { type: 'string', maxLength: 80 },
        category: { type: 'string', maxLength: 40 },
        instructions: { type: 'string', maxLength: 500 },
        street: { type: 'string', maxLength: 120 },
        buildingName: { type: 'string', maxLength: 80 },
        floor: {
          oneOf: [{ type: 'number' }, { type: 'string', maxLength: 10 }],
        },
        city: {
          type: 'string',
          maxLength: 80,
          description: 'Only if the user provided a city.',
        },
        neighborhood: { type: 'string', maxLength: 80 },
        country: { type: 'string', maxLength: 40 },
        phone: { type: 'string', maxLength: 20 },
        pinEnabled: { type: 'boolean' },
        pin: { type: 'string', pattern: '^\\d{4}$' },
      },
      additionalProperties: false,
    },
    scopes: ['address:create'],
  },
  patch_address: {
    name: 'patch_address',
    description:
      'Patch only provided fields (e.g. instructions). Does not clear omitted fields. Coordinates cannot be changed.',
    inputSchema: {
      type: 'object',
      required: ['code', 'changes'],
      properties: {
        code: { type: 'string', pattern: '^[1-9]{9}$' },
        changes: {
          type: 'object',
          properties: {
            ownerName: { type: 'string', maxLength: 80 },
            label: { type: 'string', maxLength: 80 },
            instructions: { type: 'string', maxLength: 500 },
            street: { type: 'string', maxLength: 120 },
            buildingName: { type: 'string', maxLength: 80 },
            floor: {
              oneOf: [{ type: 'number' }, { type: 'string', maxLength: 10 }],
            },
            city: { type: 'string', maxLength: 80 },
            neighborhood: { type: 'string', maxLength: 80 },
            country: { type: 'string', maxLength: 40 },
            phone: { type: 'string', maxLength: 20 },
            pinEnabled: { type: 'boolean' },
            pin: { type: 'string', pattern: '^\\d{4}$' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    scopes: ['address:update'],
  },
  share_address: {
    name: 'share_address',
    description: 'Return the public deep link for an owned address code.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string', pattern: '^[1-9]{9}$' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    scopes: ['address:share'],
  },
  delete_address: {
    name: 'delete_address',
    description: 'Permanently delete an address owned by the connected account.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: { type: 'string', pattern: '^[1-9]{9}$' } },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
    scopes: ['address:delete'],
  },
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function textResult(obj) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  };
}

function errorResult(err) {
  const code = err?.code ? ` [${err.code}]` : '';
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${String(err?.message || err)}${code}`,
      },
    ],
  };
}

async function requireToken() {
  const tok = await loadToken();
  if (!tok?.access_token) {
    throw new Error(
      'Not logged in. Run: node login.mjs',
    );
  }
  return tok.access_token;
}

function toolsFromScopes(scopes) {
  const set = new Set(Array.isArray(scopes) ? scopes : []);
  return Object.values(TOOL_SCHEMAS).filter((tool) => {
    if (!tool.scopes || tool.scopes.length === 0) return true;
    return tool.scopes.every((s) => set.has(s));
  });
}

async function listToolsFiltered() {
  const accessToken = await requireToken();
  try {
    const catalog = await mcpCall(accessToken, { action: 'tools/list' });
    const allowed = new Set(
      (catalog.tools || []).map((t) => t.name).filter(Boolean),
    );
    return Object.values(TOOL_SCHEMAS).filter(
      (t) => t.name === 'session' || allowed.has(t.name),
    );
  } catch {
    const session = await mcpCall(accessToken, { action: 'session' });
    return toolsFromScopes(session.scopes || []);
  }
}

async function callTool(name, args) {
  const accessToken = await requireToken();
  if (name === 'session') {
    const raw = await mcpCall(accessToken, { action: 'session' });
    return publicSessionView(raw);
  }
  const raw = await mcpCall(accessToken, {
    action: 'tools/call',
    name,
    arguments: args || {},
  });
  return stripAgentPayload(raw);
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  if (
    method === 'notifications/initialized' ||
    method?.startsWith('notifications/')
  ) {
    return;
  }

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    try {
      const tools = await listToolsFiltered();
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map(
            ({ name, description, inputSchema, annotations }) => ({
              name,
              description,
              inputSchema,
              ...(annotations ? { annotations } : {}),
            }),
          ),
        },
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message || String(err) },
      });
    }
    return;
  }

  if (method === 'tools/call') {
    try {
      const name = String(params?.name || '').trim();
      const args = params?.arguments || {};
      const result = await callTool(name, args);
      send({ jsonrpc: '2.0', id, result: textResult(result) });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: errorResult(err),
      });
    }
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  handle(msg).catch((err) => {
    if (msg?.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32000, message: err.message || String(err) },
      });
    }
  });
});
