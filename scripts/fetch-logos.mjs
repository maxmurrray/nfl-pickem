#!/usr/bin/env node
/**
 * Download every team logo the picks graphic uses into public/logos/nfl/.
 *
 *   node scripts/fetch-logos.mjs
 *
 * The graphic used to fetch these from ESPN on every render — 26 round trips
 * before a single pixel was drawn. That was fine locally and far too slow on a
 * serverless function, where it pushed the endpoint past its timeout. Logos
 * change about once a decade, so they belong in the repo.
 *
 * One file per team, already the correct variant: teams flagged `whiteLogo` in
 * src/lib/teams.ts take ESPN's "500-dark" (white-on-transparent) version,
 * because their full-colour mark is too low-contrast on their own card colour.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public", "logos", "nfl");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Parsed from the single source of truth rather than duplicated here.
const teamsSrc = readFileSync(join(ROOT, "src", "lib", "teams.ts"), "utf8");
const teams = [];
for (const m of teamsSrc.matchAll(
  /^\s{2}([A-Z]{2,3}):\s*\{\s*card:\s*"(#[0-9A-Fa-f]{6})"(,\s*whiteLogo:\s*(true|false))?/gm
)) {
  teams.push({ abbr: m[1], whiteLogo: m[4] === "true" });
}

if (teams.length !== 32) {
  console.error(`✗ Expected 32 teams in src/lib/teams.ts, parsed ${teams.length}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const url = ({ abbr, whiteLogo }) =>
  `https://a.espncdn.com/i/teamlogos/nfl/${whiteLogo ? "500-dark" : "500"}/${abbr.toLowerCase()}.png`;

let ok = 0;
const failed = [];

await Promise.all(
  teams.map(async (team) => {
    const href = url(team);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || !buf.subarray(0, 4).equals(PNG_MAGIC)) {
        throw new Error("not a PNG");
      }
      writeFileSync(join(OUT, `${team.abbr}.png`), buf);
      ok++;
    } catch (e) {
      failed.push(`${team.abbr} (${e instanceof Error ? e.message : e})`);
    }
  })
);

console.log(`\n✓ ${ok}/${teams.length} logos written to public/logos/nfl/`);
if (failed.length) {
  console.error(`✗ failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("  Commit them — the graphic reads these from disk at render time.\n");
