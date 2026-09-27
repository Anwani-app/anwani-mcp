# Anwani MCP

Public Cursor / MCP bridge for [Anwani](https://9code.app) (عنواني).

Create, list, update, share, and delete digital address codes **after you approve** in the browser (Google OAuth + PKCE).

Product page: https://9code.app/ai-agents

OAuth client id: `anwani-cursor`

This repository is a **connection client only**. It does not contain Firebase project internals, Firestore paths, or server secrets.

## Requirements

- Node.js 18+
- [Cursor](https://cursor.com) (or another MCP client)
- An Anwani account (created automatically during Google consent if you are new)

## Quick start

```bash
git clone https://github.com/Daheimumzug/anwani-mcp.git
cd anwani-mcp
node login.mjs
```

What happens:

1. A local callback server starts on this machine
2. Your browser opens the Anwani authorize page
3. You sign in with Google and click **Allow**
4. The browser returns to localhost — the bridge saves the token automatically

No JSON paste. Never paste codes or tokens into chat.

Fallback (rare): `node login.mjs --paste` if loopback is blocked on your network.

## Cursor MCP config

Add an absolute path to `server.mjs` on **your** machine:

```json
{
  "mcpServers": {
    "anwani": {
      "command": "node",
      "args": ["/absolute/path/to/anwani-mcp/server.mjs"]
    }
  }
}
```

Windows PowerShell:

```powershell
(Resolve-Path .\server.mjs).Path
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

Photo upload is not available via this bridge — use the Anwani app or Telegram for photos.

## Security

- Tokens live in `~/.anwani-mcp/` (never inside this repo).
- Access tokens are opaque `anwani_at_…` values.
- Same account quota as the app / Telegram (usually 10 addresses).
- Revoke by running login again (re-consent invalidates prior tokens) or email support@9code.app.

## Smoke test

```bash
node smoke.mjs
```

## License

MIT
