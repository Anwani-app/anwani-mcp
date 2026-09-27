#!/usr/bin/env node
'use strict';

/**
 * After login: session + list (no create unless --create).
 * Strips internal IDs from printed session view.
 */

import { randomBytes } from 'node:crypto';
import { loadToken, mcpCall, publicSessionView } from './lib.mjs';

async function main() {
  const create = process.argv.includes('--create');
  const tok = await loadToken();
  if (!tok?.access_token) {
    throw new Error('No token — run node login.mjs first');
  }

  const session = publicSessionView(
    await mcpCall(tok.access_token, { action: 'session' }),
  );
  console.log('session:', JSON.stringify(session, null, 2));

  const listed = await mcpCall(tok.access_token, {
    action: 'tools/call',
    name: 'list_addresses',
    arguments: {},
  });
  const count = Array.isArray(listed.addresses) ? listed.addresses.length : 0;
  console.log(`list_addresses: ${count} address(es)`);

  if (!create) {
    console.log('Pass --create to mint one test address (Damascus sample pin).');
    return;
  }

  const created = await mcpCall(tok.access_token, {
    action: 'tools/call',
    name: 'create_address',
    arguments: {
      idempotency_key: `cursor-e2e-${randomBytes(8).toString('hex')}`,
      latitude: 33.5138,
      longitude: 36.2765,
      ownerName: 'اختبار كرسر',
      instructions: 'اختبار واقعي من جسر كرسر',
      city: 'دمشق',
      country: 'سوريا',
    },
  });
  console.log('create_address:', JSON.stringify(created, null, 2));

  const listed2 = await mcpCall(tok.access_token, {
    action: 'tools/call',
    name: 'list_addresses',
    arguments: {},
  });
  const count2 = Array.isArray(listed2.addresses) ? listed2.addresses.length : 0;
  console.log(`list_addresses after create: ${count2}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
