#!/usr/bin/env bash
# Registers the Worker's /telegram URL with Telegram, with the webhook secret header.
# Usage: scripts/set-webhook.sh https://baby-milestones-companion.<your-subdomain>.workers.dev
# Asks for the bot token and webhook secret without echoing them, so they stay out of shell history.
set -euo pipefail

url="${1:?usage: scripts/set-webhook.sh <worker-url>}"
case "$url" in https://*) ;; *) echo "The Worker URL must start with https://" >&2; exit 1 ;; esac

read -rsp "Bot token: " token; echo
read -rsp "Webhook secret (same as TELEGRAM_WEBHOOK_SECRET): " secret; echo

body=$(printf '{"url":"%s/telegram","secret_token":"%s","allowed_updates":["message","callback_query"],"drop_pending_updates":true}' "${url%/}" "$secret")
curl -sS -X POST "https://api.telegram.org/bot${token}/setWebhook" -H 'content-type: application/json' --data @- <<<"$body"
echo
curl -sS "https://api.telegram.org/bot${token}/getWebhookInfo" | sed -E 's/"url":"[^"]*"/"url":"(set)"/'
echo
