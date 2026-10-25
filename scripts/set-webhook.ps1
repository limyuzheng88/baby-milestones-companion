# Registers the Worker's /telegram URL with Telegram, with the webhook secret header. PowerShell version of set-webhook.sh.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\set-webhook.ps1 https://baby-milestones-companion.<your-subdomain>.workers.dev
# Asks for the bot token and webhook secret without echoing them, so they stay out of history.
param([Parameter(Mandatory = $true)][string]$Url)
$ErrorActionPreference = 'Stop'

if (-not $Url.StartsWith('https://')) { throw 'The Worker URL must start with https://' }

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$token = Read-Secret 'Bot token'
$secret = Read-Secret 'Webhook secret (same as TELEGRAM_WEBHOOK_SECRET)'

$body = @{
  url                  = "$($Url.TrimEnd('/'))/telegram"
  secret_token         = $secret
  allowed_updates      = @('message', 'callback_query')
  drop_pending_updates = $true
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType 'application/json' -Body $body | Format-List
$info = (Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo").result
$info.url = '(set)'
$info | Format-List
