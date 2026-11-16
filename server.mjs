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

const TOOL_SCHEMAS = {
  session: {
    name: 'session',
    description:
      'Check that Anwani is connected for this user. Does not return internal IDs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  list_addresses: {
    name: 'list_addresses',
    description:
      'List addresses owned by the connected Anwani account (same quota as app/Telegram).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    scopes: ['address:update'],
  },
  share_address: {
    name: 'share_address',
    description: 'Return the public deep link for an owned address code.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: CODE_PROP },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    scopes: ['address:share'],
  },
  delete_address: {
    name: 'delete_address',
    description: 'Permanently delete an address owned by the connected account.',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: { code: CODE_PROP },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
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
