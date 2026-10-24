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

## Pipeline

Every pull request and every push to `main` runs the **CI / checks** job: install, typecheck, tests, a
personal-data scan (`npm run scan:personal`) and a secret scan (gitleaks). Only `main` deploys, and only after
the same checks pass (`.github/workflows/deploy.yml`). Nobody deploys from a laptop: the Cloudflare API token
exists only as a GitHub secret.

The personal-data scan fails on Singapore NRIC/FIN numbers, Singapore phone numbers, and postal codes next to
"Singapore". For extra safety, put family names, birthdays and similar one per line in `scan-denylist.txt`
(git-ignored) and run `npm run scan:personal` before pushing. CI logs never print denylist matches.

### Protect `main` (owner, once)

In GitHub: **Settings → Rules → Rulesets → New branch ruleset**, target `main`, and turn on:
- Restrict deletions, Block force pushes
- Require a pull request before merging
- Require status checks to pass, and add **checks**

Then **Settings → Code security**: enable Secret scanning and Push protection.

### Deploy secrets (owner, once)

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template, plus **D1: Edit**, scoped to your account.
2. In GitHub: **Settings → Environments → New environment** named `production`. Optionally add yourself as a required reviewer.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (shown on the Workers overview page).
