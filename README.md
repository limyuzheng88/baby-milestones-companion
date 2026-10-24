# Baby Milestones Companion

A private Telegram companion that gently tracks a baby's developmental milestones and family events. It runs on Cloudflare Workers with a D1 database and uses Claude for understanding free-text messages.

> This repository is public. It must never contain family details (names, dates of birth, ID numbers, phone numbers, addresses, chat IDs) or copyrighted milestone wording. Real data lives only in the deployed database and in git-ignored files.

## One-time setup (owner)

1. **Telegram bot:** message [@BotFather](https://t.me/BotFather), run `/newbot`, and keep the token. Find your own numeric Telegram user ID (for example via @userinfobot).
2. **Cloudflare:** create a free account, then run `npx wrangler login` and `npx wrangler d1 create baby-milestones`. Put the printed `database_id` in `wrangler.toml`.
3. **Anthropic API:** create a key at console.anthropic.com, add a small prepaid credit, and set a monthly spend limit in the console.
4. **Secrets** (never commit these):
   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string: openssl rand -hex 32
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put ENCRYPTION_KEY            # openssl rand -base64 32
   npx wrangler secret put OWNER_TELEGRAM_ID
   ```

## Development

```sh
npm ci
npm test          # Vitest inside the Workers runtime, with a local D1
npm run typecheck
```
