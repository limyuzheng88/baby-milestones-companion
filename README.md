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
5. **Milestone library:** the checklist wording is not in this repository (see `docs/sources.md`). Put the library
   file at `data/milestones.private.json` (git-ignored) and run `npm run validate:library`. It is loaded after the first deploy.

## First deploy and webhook

1. Set up the [deploy secrets](#deploy-secrets-owner-once) and merge to `main`. The pipeline applies migrations and deploys.
2. Load the milestone library into the now-migrated database: `npm run seed:remote`.
3. Register the webhook with the Worker URL from the deploy log:
   ```sh
   scripts/set-webhook.sh https://baby-milestones-companion.<your-subdomain>.workers.dev
   ```
4. In Telegram, send `/start` to the bot from the owner account and follow the setup.

Acceptance check on a test bot: onboarding completes; a second, unapproved account gets no reply; with the note
time set to the next hour ("send notes at 3pm"), the note arrives with buttons and each tap updates the message;
"she smiled at me today" gives a confirm card; "send the notes at 8pm" changes the time and Undo restores it;
`/show_milestones` lists answers and notes.

## Rollback

Revert the pull request on GitHub; merging the revert redeploys the previous code through the pipeline. In an
emergency, `npx wrangler rollback` restores the previous Worker version immediately (database migrations are not
rolled back, so migrations must stay backwards compatible).

## Development

```sh
npx -y npm@11 ci     # npm 11 is required
npm test             # Vitest inside the Workers runtime, with a local D1
npm run typecheck
npm run scan:personal
npm run seed:local   # load data/milestones.private.json into the local D1 for wrangler dev
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
