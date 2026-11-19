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

/** MCP spec 2025-06-18 — structured output / annotations era */
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'anwani', version: pkgVersion };

const CODE_PROP = {
  type: 'string',
  pattern: '^[1-9]{9}$',
  description:
    'Anwani permanent 9-digit address code (digits 1–9 only). Example: 365131449',
};

const PIN_PROP = {
  type: 'string',
  pattern: '^\\d{4}$',
  description:
    'Optional 4-digit privacy PIN that couriers must enter to view details. Example: 4821',
};

const FLOOR_PROP = {
  oneOf: [
    { type: 'number', description: 'Floor number as integer. Example: 5' },
    {
      type: 'string',
      maxLength: 10,
      description: 'Floor label when not a plain number. Example: G or 3B',
    },
  ],
  description: 'Floor / level of the unit. Example: 5 or G',
};

const ADDRESS_FIELD_PROPS = {
  ownerName: {
    type: 'string',
    maxLength: 80,
    description:
      'Display name for the address owner only if the user provided one. Example: أحمد',
  },
  label: {
    type: 'string',
    maxLength: 80,
    description: 'Short friendly label for the address. Example: البيت or المكتب',
  },
  category: {
    type: 'string',
    maxLength: 40,
    description: 'Optional category tag. Example: home, work, shop',
  },
  instructions: {
    type: 'string',
    maxLength: 500,
    description:
      'Delivery notes for the courier (door color, buzzer, landmark). Example: الباب الأصفر، دق الجرس',
  },
  street: {
    type: 'string',
    maxLength: 120,
    description: 'Street name if the user provided it. Example: شارع التحلية',
  },
  houseNumber: {
    type: 'string',
    maxLength: 20,
    description: 'House / unit number if provided. Example: 12',
  },
  buildingName: {
    type: 'string',
    maxLength: 80,
    description: 'Building name if provided. Example: برج الملقا',
  },
  floor: FLOOR_PROP,
  postalCode: {
    type: 'string',
    maxLength: 20,
    description: 'Postal / ZIP code if provided. Example: 13521',
  },
  city: {
    type: 'string',
    maxLength: 80,
    description: 'City only if the user provided it. Example: الرياض',
  },
  neighborhood: {
    type: 'string',
    maxLength: 80,
    description: 'Neighborhood / district if provided. Example: حي الملقا',
  },
  country: {
    type: 'string',
    maxLength: 40,
    description:
      'Country name or ISO-ish label if provided. Example: السعودية or SA',
  },
  saudiNationalCode: {
    type: 'string',
    maxLength: 8,
    description:
      'Optional Saudi national short code (4 letters + 4 digits, AAAA####) when country is SA. Does not replace the Anwani 9-digit code. Example: RADC2959',
  },
  phone: {
    type: 'string',
    maxLength: 20,
    description:
      'Contact phone in international or local form if provided. Example: +9665xxxxxxx',
  },
  pinEnabled: {
    type: 'boolean',
    description:
      'When true, details stay locked until the correct 4-digit PIN is entered. Example: true',
  },
  pin: PIN_PROP,
};

const PATCH_FIELD_PROPS = {
  ...ADDRESS_FIELD_PROPS,
  saudiNationalCode: {
    type: 'string',
    maxLength: 8,
    description:
      'Optional Saudi national short code (AAAA####) when country is SA. Pass empty string to clear. Example: RADC2959',
  },
};

/** Loose address object (additionalProperties stay open so clients never reject). */
const ADDRESS_OUTPUT_SCHEMA = {
  type: 'object',
  description: 'One owned Anwani address (no internal user IDs).',
  properties: {
    code: {
      type: 'string',
      description: 'Permanent 9-digit Anwani address code.',
    },
    label: { type: 'string', description: 'Friendly label, if set.' },
    latitude: { type: 'number', description: 'Pin latitude.' },
    longitude: { type: 'number', description: 'Pin longitude.' },
    url: { type: 'string', description: 'Public link https://9code.app/code/{code}.' },
    updatedAt: { type: 'number', description: 'Last update time (epoch ms).' },
  },
  additionalProperties: true,
};

const TOOL_SCHEMAS = {
  check_session: {
    name: 'check_session',
    description:
      'Returns connection status for the signed-in Anwani user as {ok, connected, scopes, expiresAt}. Identity comes from the saved OAuth token (no parameters) and never includes Firebase UIDs or internal IDs. Use it when unsure the user is signed in before calling address tools; do not use it to list or change addresses (use list_addresses, get_address, create_address, patch_address instead). Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'True when the request succeeded.' },
        connected: {
          type: 'boolean',
          description: 'True when a valid OAuth token is saved.',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Granted scopes, e.g. address:read.',
        },
        expiresAt: {
          description: 'Token expiry (epoch ms or ISO string), or null.',
        },
      },
      additionalProperties: true,
    },
    annotations: {
      title: 'Check Anwani session',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  list_addresses: {
    name: 'list_addresses',
    description:
      'Returns all addresses owned by the connected account as {ok, addresses[]} (same quota as app/Telegram, typically up to 10), newest updates first. Use it to browse or when you do not yet know a 9-digit code; use get_address when you already have a code. Read-only; the account comes from OAuth.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'True when the request succeeded.' },
        addresses: {
          type: 'array',
          items: ADDRESS_OUTPUT_SCHEMA,
          description: 'Owned addresses, newest updates first.',
        },
      },
      additionalProperties: true,
    },
    annotations: {
      title: 'List my addresses',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    scopes: ['address:read'],
  },
  get_address: {
    name: 'get_address',
    description:
      'Returns one owned address by its permanent 9-digit code as {ok, address}. Use it when the user already provided a code; use list_addresses to discover codes. Fails clearly if the code is invalid or not owned by the connected account. Read-only; does not mutate.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: CODE_PROP },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'True when the request succeeded.' },
        address: ADDRESS_OUTPUT_SCHEMA,
      },
      additionalProperties: true,
    },
    annotations: {
      title: 'Get one address',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    scopes: ['address:read'],
  },
  create_address: {
    name: 'create_address',
    description:
      'Creates one new permanent 9-digit Anwani address within the account quota and returns {ok, code, created, url}. Requires a real user-provided latitude/longitude (map pin) — NEVER invent coordinates, city, or name; if the user gave no location (coords, Maps link, or clear place), ask first and do not call with sample data. Use it for new places; use patch_address to edit an existing code. Not idempotent unless the same idempotency_key is retried, which returns the original result.',
    inputSchema: {
      type: 'object',
      required: ['idempotency_key', 'latitude', 'longitude'],
      properties: {
        idempotency_key: {
          type: 'string',
          minLength: 8,
          maxLength: 128,
          description:
            'Client-generated key to safely retry the same create without duplicates. Example: create-2026-11-16-home-a1b2c3d4',
        },
        latitude: {
          type: 'number',
          minimum: -90,
          maximum: 90,
          description:
            'User-provided latitude only — never invent. Example: 24.7136',
        },
        longitude: {
          type: 'number',
          minimum: -180,
          maximum: 180,
          description:
            'User-provided longitude only — never invent. Example: 46.6753',
        },
        ...ADDRESS_FIELD_PROPS,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'True when the request succeeded.' },
        code: {
          type: 'string',
          description: 'New permanent 9-digit Anwani address code.',
        },
        created: { type: 'boolean', description: 'True when a new address was made.' },
        url: { type: 'string', description: 'Public link https://9code.app/code/{code}.' },
      },
      additionalProperties: true,
    },
    annotations: {
      title: 'Create address',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    scopes: ['address:create'],
  },
  patch_address: {
    name: 'patch_address',
    description:
      'Updates only the fields present in `changes` on an owned address and returns the result; omitted fields stay unchanged. Coordinates are immutable after create. Use it to edit label, instructions, floor and similar fields; use create_address for a new pin; use delete_address only to remove an address permanently. Fails if the code is not owned by the connected account.',
    inputSchema: {
      type: 'object',
      required: ['code', 'changes'],
      properties: {
        code: CODE_PROP,
        changes: {
          type: 'object',
          description:
            'Partial address fields to update. Omit keys you do not want to change. Example: {"instructions":"الباب الأصفر","floor":5}',
          properties: PATCH_FIELD_PROPS,
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    annotations: {
      title: 'Update address fields',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    scopes: ['address:update'],
  },
  share_address: {
    name: 'share_address',
    description:
      'Returns the public deep link https://9code.app/code/{code} for an owned address as {ok, code, url, shareText}. Use it when the user wants a shareable URL; it does not modify the address. Fails if the code is invalid or not owned by the connected account.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: CODE_PROP },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean', description: 'True when the request succeeded.' },
        code: { type: 'string', description: 'The 9-digit address code.' },
        url: { type: 'string', description: 'Public link https://9code.app/code/{code}.' },
        shareText: { type: 'string', description: 'Text to paste when sharing.' },
      },
      additionalProperties: true,
    },
    annotations: {
      title: 'Share address link',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    scopes: ['address:share'],
  },
  delete_address: {
    name: 'delete_address',
    description:
      'Permanently deletes an owned address and its photos (irreversible) and returns {ok, deleted}. Prefer patch_address for edits; confirm user intent before calling. Fails if the code is not owned by the connected account.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: CODE_PROP },
      additionalProperties: false,
    },
    annotations: {
      title: 'Delete address',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    scopes: ['address:delete'],
  },
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function textResult(obj) {
  const result = {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  };
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    result.structuredContent = obj;
  }
  return result;
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
  // Discovery / Glama inspect must work without a local OAuth token.
  // Auth is enforced on tools/call only.
  const tok = await loadToken();
  if (!tok?.access_token) {
    return Object.values(TOOL_SCHEMAS);
  }
  const accessToken = tok.access_token;
  try {
    const catalog = await mcpCall(accessToken, { action: 'tools/list' });
    const allowed = new Set(
      (catalog.tools || []).map((t) => t.name).filter(Boolean),
    );
    // check_session replaces backend `session` (always listed).
    // get_address shares address:read with list_addresses (older backends omit it).
    return Object.values(TOOL_SCHEMAS).filter(
      (t) =>
        t.name === 'check_session' ||
        allowed.has(t.name) ||
        (t.name === 'get_address' && allowed.has('list_addresses')),
    );
  } catch {
    try {
      const session = await mcpCall(accessToken, { action: 'session' });
      return toolsFromScopes(session.scopes || []);
    } catch {
      return Object.values(TOOL_SCHEMAS);
    }
  }
}

async function callTool(name, args) {
  const accessToken = await requireToken();
  // `session` is the legacy name for check_session.
  if (name === 'check_session' || name === 'session') {
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
            ({ name, description, inputSchema, outputSchema, annotations }) => ({
              name,
              description,
              inputSchema,
              ...(outputSchema ? { outputSchema } : {}),
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
