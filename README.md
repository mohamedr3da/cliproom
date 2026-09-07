# ClipRoom

Private Twitch clip queue for creator teams, deployed on Cloudflare Workers with D1.

## Authentication

ClipRoom now uses Twitch OAuth instead of email/username access codes.

- Admins add a team member by Twitch username and role.
- ClipRoom resolves that username to Twitch's immutable user ID.
- The member signs in through Twitch.
- ClipRoom never receives the user's Twitch password and does not store Twitch login access tokens.

The first admin signs in with Twitch and enters `CLIPROOM_ADMIN_CODE` once. Existing legacy username/email members stay in the database but are not considered active Twitch-auth members until they are linked/re-added through the Team panel.

## Required Cloudflare secrets

```bash
npx wrangler secret put TWITCH_CLIENT_ID
npx wrangler secret put TWITCH_CLIENT_SECRET
npx wrangler secret put CLIPROOM_ADMIN_CODE
```

Do not put secret values in `wrangler.jsonc` or GitHub.

## Twitch OAuth redirects

Production:

```text
https://cliproom.sevencliproom.workers.dev
```

For local testing, add the exact localhost root printed by the dev server, for example:

```text
http://localhost:3000
```

Twitch requires an exact redirect match.

## Local development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` (or `.dev.vars`, depending on your local Wrangler/Vinext setup) and fill in local values. Never commit it.

If the local D1 schema is empty:

```bash
npx wrangler d1 execute cliproom-db-us --local --file=drizzle/0000_cliproom_initial.sql
```

The application also upgrades the existing ClipRoom schema on first run to add Twitch identity and OAuth-state columns.

## Checks

```bash
npm run lint
npm run build
```

## Deploy

```bash
npm run deploy
```

The Worker remains `cliproom` and uses the configured `cliproom-db-us` D1 binding.
