import { neon } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = neon(databaseUrl);
const verifyOnly = process.argv.includes("--verify");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sqlDir = resolve(repoRoot, "packages/db/sql");
const files = (await readdir(sqlDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();

await sql.query(`
  CREATE TABLE IF NOT EXISTS moms_ops.schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const appliedRows = await sql.query("SELECT filename FROM moms_ops.schema_migrations ORDER BY filename");
const applied = new Set(appliedRows.map((row) => row.filename));
const pending = files.filter((file) => !applied.has(file));

if (verifyOnly) {
  if (pending.length) {
    console.error(`Pending database migrations: ${pending.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`Database migrations verified: ${files.length} applied, 0 pending.`);
  }
} else {
  for (const file of pending) {
    const migration = await readFile(resolve(sqlDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await sql.transaction([
      sql.query(migration),
      sql.query("INSERT INTO moms_ops.schema_migrations (filename) VALUES ($1)", [file]),
    ]);
    console.log(`Applied ${file}.`);
  }
  console.log(`Database migration complete: ${pending.length} applied, ${files.length - pending.length} already present.`);
}
