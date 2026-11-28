# Secure Preview to Production Telegram migration

This is a one-time local operations script. It is not called by the app and does not print Telegram tokens, encrypted token payloads, database credentials, password hashes, or OAuth credentials.

## Requirements

- Run from this repository with Node.js installed.
- Install dependencies with npm install if needed.
- Have the Preview and Production Neon connection strings available from the Neon console.
- Use the exact BOT_TOKEN_ENCRYPTION_KEY already configured on the Production Railway service. Do not generate or rotate this key.
- Optionally provide the Production MANAGEMENT_BOT_TOKEN and MANAGEMENT_BOT_WEBHOOK_SECRET to move the management bot webhook too.

## Windows PowerShell

From the repository root, switch to this branch:

~~~powershell
git fetch origin
git checkout ops/production-webhook-migration
npm install
~~~

Enter credentials using hidden prompts (input is not echoed and is not placed in shell history):

~~~powershell
function Set-HiddenEnv([string]$Name, [bool]$Optional = $false) {
  $secure = Read-Host $Name -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if (-not $Optional -and [string]::IsNullOrWhiteSpace($value)) { throw "$Name is required" }
    [Environment]::SetEnvironmentVariable($Name, $value, "Process")
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}
Set-HiddenEnv "PREVIEW_DATABASE_URL"
Set-HiddenEnv "PRODUCTION_DATABASE_URL"
Set-HiddenEnv "BOT_TOKEN_ENCRYPTION_KEY"
Set-HiddenEnv "MANAGEMENT_BOT_TOKEN" $true
Set-HiddenEnv "MANAGEMENT_BOT_WEBHOOK_SECRET" $true
$env:PRODUCTION_APP_URL = "https://telegram-bot-saas-app-ggr7-production.up.railway.app"
npx tsx scripts/migrate-preview-bots-to-production.ts
~~~

The two management-bot values must either both be provided or both be left blank.

## What the script does

1. Reads active bot rows and encrypted tokens from Preview.
2. Decrypts tokens only in local process memory with the existing encryption key and calls Telegram getMe to validate identity. It never prints token material.
3. Copies encrypted bot-token rows and Better Auth account rows into Production in a database transaction, without overwriting existing rows.
4. Generates fresh per-bot webhook secrets, stores only their SHA-256 hashes in Production, and registers the customer-bot webhooks at the Production URL.
5. If both management-bot values were provided, registers that webhook at the Production URL too.
6. Prints only bot usernames and completion counts.

The script refuses to overwrite a webhook pointing at an unrecognized host. It does not change the encryption key, delete Preview data, or transfer image objects.

After success, test each customer bot with a fresh Telegram message and verify the corresponding update timestamp increases in the Production database. Keep Preview available as rollback until those tests pass.
