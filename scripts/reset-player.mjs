#!/usr/bin/env node
/**
 * Give one player a clean slate — blank board, no saved picks.
 *
 *   node scripts/reset-player.mjs rich              # records + picks
 *   node scripts/reset-player.mjs rich --records    # AFC/NFC records only
 *   node scripts/reset-player.mjs rich --picks      # weekly picks only
 *   node scripts/reset-player.mjs rich --dry-run    # count, delete nothing
 *   node scripts/reset-player.mjs rich --season 2026
 *
 * Two tables hold a player's data and they use DIFFERENT ids for the same
 * human — `division_predictions` stores Bruce as 'bruce', `picks` stores him
 * as 'dad'. Clearing one table and not the other is why a "reset" board can
 * still come up filled in. This script always maps both.
 *
 * Every run writes a timestamped backup into .data/ before deleting anything.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env.local: the public anon key the site
 * runs on has no delete permission (deliberately — see supabase/schema.sql),
 * so a wipe cannot be triggered from a browser by anyone who finds the URL.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Same human, two different stored ids. Keep this table honest.
const PLAYERS = {
  bruce: { records: "bruce", picks: "dad" },
  rich: { records: "rich", picks: "rich" },
};

const TABLES = {
  records: { table: "division_predictions", label: "AFC/NFC records" },
  picks: { table: "picks", label: "weekly picks" },
};

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** Same source of truth the app uses: ESPN's own season metadata. */
async function currentSeason() {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return (await res.json())?.season?.year ?? new Date().getFullYear();
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const name = args.find((a) => !a.startsWith("--"));
const seasonFlag = args.indexOf("--season");
const seasonArg = seasonFlag !== -1 ? Number(args[seasonFlag + 1]) : null;

// No scope flag means both, which is what "clean slate" almost always means.
const wants = ["records", "picks"].filter((k) => args.includes(`--${k}`));
const scopes = wants.length ? wants : ["records", "picks"];

if (!PLAYERS[name]) {
  die(`Usage: node scripts/reset-player.mjs <${Object.keys(PLAYERS).join("|")}> [--records|--picks] [--season 2026] [--dry-run]`);
}
if (seasonFlag !== -1 && !Number.isInteger(seasonArg)) die("--season needs a year, e.g. --season 2026");

loadEnvLocal();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) die("SUPABASE_URL is missing from .env.local.");
if (!key) {
  die(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n\n" +
      "  Supabase dashboard -> Project Settings -> API -> `service_role` `secret`,\n" +
      "  then add to .env.local (gitignored):\n\n" +
      "    SUPABASE_SERVICE_ROLE_KEY=sb_secret_..."
  );
}

const season = seasonArg ?? (await currentSeason());
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

console.log(`\n  ${name} · season ${season}${dryRun ? " · dry run" : ""}`);

let totalDeleted = 0;
for (const scope of scopes) {
  const { table, label } = TABLES[scope];
  const who = PLAYERS[name][scope];
  const filter = `season=eq.${season}&player=eq.${who}`;

  const read = await fetch(`${url}/rest/v1/${table}?${filter}&select=*`, { headers });
  if (!read.ok) die(`Read of ${table} failed: ${read.status} ${await read.text()}`);
  const rows = await read.json();

  if (rows.length === 0) {
    console.log(`  ${label.padEnd(15)} already clear`);
    continue;
  }
  if (dryRun) {
    console.log(`  ${label.padEnd(15)} ${rows.length} rows (stored as '${who}')`);
    continue;
  }

  // Back up before touching anything.
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  const backup = join(ROOT, ".data", `${table}-${name}-${stamp}.json`);
  writeFileSync(backup, JSON.stringify(rows, null, 2));

  const del = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!del.ok) die(`Delete from ${table} failed: ${del.status} ${await del.text()}`);
  const deleted = await del.json();

  // A blocked delete still returns a cheerful 204, so verify rather than trust.
  const after = await fetch(`${url}/rest/v1/${table}?${filter}&select=id`, { headers });
  const left = await after.json();
  if (left.length > 0) die(`Deleted ${deleted.length} from ${table} but ${left.length} remain — is that the service_role key?`);

  totalDeleted += deleted.length;
  console.log(`  ${label.padEnd(15)} cleared ${deleted.length} rows  (backup: .data/${table}-${name}-${stamp}.json)`);
}

console.log(dryRun ? "" : `\n  Done — ${totalDeleted} rows removed.\n`);
