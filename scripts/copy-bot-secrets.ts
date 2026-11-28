/**
 * Securely copy encrypted Telegram bot-token rows from Preview to Production.
 *
 * This script NEVER decrypts, prints, or otherwise exposes token values.
 * It copies ciphertext byte-for-byte; both environments must already use the
 * same BOT_TOKEN_ENCRYPTION_KEY. It does not change webhooks or bot statuses.
 *
 * Required environment:
 *   SOURCE_DATABASE_URL  Preview connection string
 *   TARGET_DATABASE_URL  Production connection string
 *
 * Safe by default: dry-run only. Add --apply to write.
 * Run: npx tsx scripts/copy-bot-secrets.ts
 *      npx tsx scripts/copy-bot-secrets.ts --apply
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error("Missing SOURCE_DATABASE_URL or TARGET_DATABASE_URL.");
  process.exit(2);
}
if (sourceUrl === targetUrl) {
  console.error("Source and target connection strings must be different.");
  process.exit(2);
}

const source = new Pool({ connectionString: sourceUrl, max: 1, connectionTimeoutMillis: 10_000 });
const target = new Pool({ connectionString: targetUrl, max: 1, connectionTimeoutMillis: 10_000 });

type SecretRow = {
  bot_id: string;
  encrypted_token: string;
  encryption_key_version: number;
  created_at: Date;
  rotated_at: Date | null;
};

async function main() {
  const [sourceDb, targetDb] = await Promise.all([
    source.query<{ name: string }>("SELECT current_database() AS name"),
    target.query<{ name: string }>("SELECT current_database() AS name"),
  ]);
  if (sourceDb.rows[0]?.name !== "telegram_saas" || targetDb.rows[0]?.name !== "telegram_saas") {
    throw new Error("Unexpected database name; expected telegram_saas on both connections.");
  }

  const sourceRows = await source.query<SecretRow>(`
    SELECT s.bot_id, s.encrypted_token, s.encryption_key_version, s.created_at, s.rotated_at
      FROM public.bot_secrets s
      JOIN public.bots b ON b.id = s.bot_id
     ORDER BY s.bot_id
  `);

  if (sourceRows.rowCount !== 2) {
    throw new Error(`Expected exactly 2 source bot-secret rows; found ${sourceRows.rowCount ?? 0}. No changes made.`);
  }
  for (const row of sourceRows.rows) {
    if (!row.encrypted_token || !row.encrypted_token.startsWith("v1.")) {
      throw new Error("A source encrypted-token record has an unsupported format. No changes made.");
    }
  }

  const botIds = sourceRows.rows.map((row) => row.bot_id);
  const targetBots = await target.query<{ id: string }>(
    "SELECT id FROM public.bots WHERE id = ANY($1::uuid[]) ORDER BY id",
    [botIds],
  );
  if (targetBots.rowCount !== botIds.length) {
    throw new Error("Not all source bots exist in Production. No changes made.");
  }

  const existing = await target.query<{ bot_id: string }>(
    "SELECT bot_id FROM public.bot_secrets WHERE bot_id = ANY($1::uuid[])",
    [botIds],
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new Error("At least one destination secret already exists. Refusing to overwrite or merge.");
  }

  console.log(`Preflight passed: ${sourceRows.rowCount} encrypted rows; matching Production bots; no destination conflicts.`);
  console.log(APPLY ? "Mode: APPLY" : "Mode: DRY RUN (no database writes)");
  if (!APPLY) {
    console.log("Review the environment variables, then rerun with --apply to perform the copy.");
    return;
  }

  const client = await target.connect();
  try {
    await client.query("BEGIN");
    for (const row of sourceRows.rows) {
      await client.query(
        `INSERT INTO public.bot_secrets
           (bot_id, encrypted_token, encryption_key_version, created_at, rotated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.bot_id, row.encrypted_token, row.encryption_key_version, row.created_at, row.rotated_at],
      );
    }
    const verification = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.bot_secrets WHERE bot_id = ANY($1::uuid[])",
      [botIds],
    );
    if (Number(verification.rows[0]?.count) !== sourceRows.rowCount) {
      throw new Error("Post-copy row-count verification failed.");
    }
    await client.query("COMMIT");
    console.log(`Success: copied and verified ${sourceRows.rowCount} encrypted bot-secret rows. Token values were not displayed.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error: unknown) => {
    const safe = error as { name?: string; code?: string };
    console.error("Transfer failed; no token values are included in this error report.", {
      error: safe?.name ?? "Error",
      code: safe?.code ?? "not_available",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([source.end(), target.end()]);
  });
