# Central management bot

## Preview-only configuration

Set these variables on the Preview target for `feat/license-customer-menu-architecture`:

- `MANAGEMENT_BOT_TOKEN`: token created with BotFather for `@modirbimebot`.
- `MANAGEMENT_BOT_WEBHOOK_SECRET`: a random secret shared with Telegram as the webhook secret token.
- `PLATFORM_SUPERADMIN_TELEGRAM_IDS`: comma-separated numeric Telegram user IDs for platform superadmins. Never use usernames here.
- `CRON_SECRET`: bearer secret for the license reminder endpoint.
- `MANAGEMENT_BOT_USERNAME`: optional; defaults to `modirbimebot`.
- `APP_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`: branch-specific Preview URL and Vercel protection bypass required by the webhook setup route.

Do not copy Preview-only values to Production without an explicit release approval. The production Vercel Cron requires a separate Production `CRON_SECRET` before enabling the scheduled deployment.

## Activate the Preview webhook

After a Preview deployment containing this branch is ready, POST to `/api/telegram/management-webhook-setup` with header `x-management-setup-secret: <MANAGEMENT_BOT_WEBHOOK_SECRET>`. The route refuses non-Preview environments and configures only the central management bot.

## Customer onboarding

1. Customer registers with email and a password of at least 12 characters.
2. While signed in, the customer requests a one-time Telegram link from the session bar.
3. Customer opens the link and presses Start in `@modirbimebot`. The token is hashed at rest, expires after 10 minutes, and can be used once.
4. The linked customer can view their license and owned bots, pause/resume their bot, and share their own Telegram contact to verify a phone number.

The current signup screen uses email/password. Telegram username is not treated as proof of identity; the account must be linked by the one-time challenge. Phone verification is available after linking via Telegram's share-contact button; phone-only signup still requires a dedicated OTP delivery provider.

## QR invitations

The authenticated `POST /api/bots/start-link` endpoint creates a random, reusable Telegram deep-link payload for an owned bot. It can optionally target an active menu. The bot webhook resolves the hashed payload and opens that menu after the end user presses Start. Telegram requires the end user to start the bot at least once. The QR image is rendered by the QR Server image endpoint from the deep link.

## License reminders

`GET /api/cron/license-reminders` is protected by `Authorization: Bearer <CRON_SECRET>`. It sends UTC calendar-day reminders at 30, 7, and 1 days before expiry, and logs each reminder with a uniqueness key to avoid duplicate sends. Vercel Cron is configured for 09:00 UTC daily; Vercel scheduled jobs run on Production deployments, so Production `CRON_SECRET` must be configured before a production release.

## Database migrations

Apply migrations `0006_central_management_bot.sql`, `0007_management_telegram_update_dedupe.sql`, and `0008_bot_start_link_targets.sql` to the intended database branch. These have been applied to the isolated Neon Preview branch only. Never run them against Production without a separate approval.
