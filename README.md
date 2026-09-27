# Anwani MCP

Anwani MCP connects AI agents to Anwani, the digital address infrastructure for permanent 9-digit address codes tied to real-world locations.

Create, list, update, share, and delete your Anwani addresses through OAuth, with the same ownership, permissions, and account limits used across Anwani.

Works with Cursor and other MCP-compatible clients. Cursor is the first supported MCP client; it is not the product identity.

Product page: https://9code.app/ai-agents

Sign-in uses Google OAuth + PKCE in the browser — approve once, then the client saves the token on this machine.

OAuth client id: `anwani-cursor`

This package is a **connection client only**. It does not contain Firebase project internals, Firestore paths, or server secrets.

## Requirements

- Node.js 18+
- An MCP-compatible client (Cursor is supported; others work the same way via stdio)
- An Anwani account (created automatically during Google consent if you are new)

## Install

```bash
npm install -g anwani-mcp
anwani-mcp-login
```

Or without a global install:

```bash
npx -y anwani-mcp-login
```

What happens:

1. A local callback server starts on this machine
2. Your browser opens the Anwani authorize page
3. You sign in with Google and click **Allow**
4. The browser returns to localhost — the bridge saves the token automatically

No JSON paste. Never paste codes or tokens into chat.

Fallback (rare): `anwani-mcp-login --paste` if loopback is blocked on your network.

## Use with Cursor

Cursor is the first supported MCP client. Recommended config (always uses the published package):

```json
{
  "mcpServers": {
    "anwani": {
      "command": "npx",
      "args": ["-y", "anwani-mcp"]
    }
  }
}
```

Then open a **new** chat and ask Anwani to create or update an address. Provide a real map pin (coordinates or Maps link) — the agent must not invent a location.

## Tools

| Tool | Needs scope | Notes |
|------|-------------|--------|
| `session` | — | Connection + granted scopes (no internal IDs) |
| `list_addresses` | `address:read` | Your addresses only |
| `create_address` | `address:create` | Requires `idempotency_key` + real lat/lng from you |
| `patch_address` | `address:update` | Field patch; coordinates locked after create |
| `share_address` | `address:share` | Public `9code.app/code/…` link |
| `delete_address` | `address:delete` | Destructive |

Photo upload is not available via this client — use the Anwani app or Telegram for photos.

## Security

- Tokens live in `~/.anwani-mcp/` (never inside this package).
- Access tokens are opaque `anwani_at_…` values.
- Same account quota as the app / Telegram (usually 10 addresses).
- Revoke by running login again (re-consent invalidates prior tokens) or email support@9code.app.

## From source

```bash
git clone https://github.com/Anwani-app/anwani-mcp.git
cd anwani-mcp
node login.mjs
```

## Smoke test

From a clone:

```bash
node smoke.mjs
```

## Publish / directories

See [PUBLISH.md](./PUBLISH.md) for Official MCP Registry, Glama, Smithery, and npm.

- Local (any MCP client, e.g. Cursor): `npx -y anwani-mcp` after `anwani-mcp-login`
- Remote: `https://us-central1-nine-code-anwani.cloudfunctions.net/mcpRemote`

## License

MIT
