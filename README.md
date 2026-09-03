# ClipRoom

ClipRoom is a private Twitch clip queue for creator teams. Admins invite trusted clippers by email, add Twitch clips, organise them by category, prioritise important moments, and track each clip from claim to posted.

## Stack

- Vinext app router
- React
- Tailwind CSS
- Cloudflare Workers
- Cloudflare D1

## Local Setup

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set `CLIPROOM_ADMIN_CODE` before testing the first admin sign-in.

## Cloudflare Setup

1. Create a D1 database named `cliproom-db-us`.
2. Copy its database ID into `wrangler.jsonc`.
3. Add the admin setup code as a Worker secret:

```bash
npx wrangler secret put CLIPROOM_ADMIN_CODE
```

Optional Twitch sync needs `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` set as Worker secrets too. In ClipRoom, set the Twitch source channel and the trusted Twitch usernames allowed to feed the automatic queue; sync only imports clips created by those users.

## Deploy

```bash
npm run deploy
```
