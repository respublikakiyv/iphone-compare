import { db, failure, internal, json } from "../../../../lib/auth";

const schema = [
  "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL, message TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, requested_by TEXT NOT NULL, lease INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY NOT NULL, rate TEXT NOT NULL, updated TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS account_links (web_id TEXT PRIMARY KEY NOT NULL, telegram_id TEXT NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS account_links_telegram_id_unique ON account_links (telegram_id)",
  "CREATE TABLE IF NOT EXISTS cloud_refresh (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, lease INTEGER NOT NULL DEFAULT 0, token TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS link_codes (code TEXT PRIMARY KEY NOT NULL, telegram_id TEXT NOT NULL, expires INTEGER NOT NULL)",
];

export async function POST(request: Request) {
  try {
    internal(request);
    await db().batch(schema.map((statement) => db().prepare(statement)));
    return json({ ok: true, tables: 6 });
  } catch (error) {
    return failure(error);
  }
}
