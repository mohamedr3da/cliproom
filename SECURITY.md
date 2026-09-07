# ClipRoom security notes

ClipRoom uses Twitch OAuth for identity and Cloudflare/D1 for application sessions.

## Authentication

- Twitch passwords are never sent to ClipRoom.
- The OAuth authorisation code flow is handled server-side.
- OAuth `state` values are cryptographically random, stored hashed in D1, expire after 10 minutes, and are single-use.
- Twitch access tokens used for sign-in are used only to fetch the verified Twitch identity and are then revoked on a best-effort basis. They are never stored in D1.
- Membership is bound to Twitch's immutable user ID, not a changeable Twitch username.
- The first admin must both authenticate with Twitch and supply `CLIPROOM_ADMIN_CODE`. After a Twitch-linked admin exists, the setup code cannot bootstrap another account.
- ClipRoom session tokens are random. Only SHA-256 hashes of the session tokens are stored in D1.
- Production cookies use the `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`.
- Removing a member deletes their ClipRoom sessions immediately.

## Authorisation

- Admin-only operations are enforced server-side.
- Clippers can view the queue, claim clips, advance their own claimed work, and mark it posted.
- Clippers can add/delete standalone clips, create and edit Collections, and run trusted Twitch sync.
- Clippers cannot add/remove members, change roles, change priorities, or edit Twitch source settings.
- Clip claiming uses a conditional database update to reduce double-claim races.

## Request hardening

- State-changing API calls perform same-origin checks in addition to SameSite cookies.
- JSON request bodies are size-limited.
- Twitch usernames, clip URLs, titles, and notes are validated and bounded.
- API responses disable caching and include baseline security headers.

## Rate limiting / DDoS layers

The server supports optional Cloudflare Workers Rate Limiting bindings:

- `AUTH_RATE_LIMITER`: protects OAuth status/start/callback endpoints.
- `API_RATE_LIMITER`: protects authenticated session traffic.
- `TWITCH_RATE_LIMITER`: protects Twitch-backed actions.

These bindings are intentionally optional so local development and free Worker deployments still run without placeholder IDs. If the bindings are added to `wrangler.jsonc`, the code applies them before the expensive parts of the relevant request path. Trusted Twitch sync also has a D1-backed cooldown so clippers can run it without letting the room spam Twitch. These limits are not a replacement for Cloudflare's network-level DDoS mitigation, which remains the first layer in front of the Worker.

## Secrets

Keep these only in Cloudflare Worker secrets / local untracked env files:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `CLIPROOM_ADMIN_CODE`

Never commit a Twitch Client Secret. If it appears in a screenshot, chat, log, repository, or other exposed location, rotate it in the Twitch Developer Console before using it.
