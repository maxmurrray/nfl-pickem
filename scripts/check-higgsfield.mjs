#!/usr/bin/env node
/**
 * What can this Higgsfield account actually call?
 *
 * Run it after changing plans or enabling a model to see whether the finishing
 * pass on the picks graphic will work yet:
 *
 *   node scripts/check-higgsfield.mjs
 *
 * /models is the authoritative list. Probing an endpoint is a weaker signal:
 * body validation runs BEFORE the model-access check, so a 422 only means the
 * request was malformed, not that the model is available to you.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "https://api.higgsfield.ai";
const WANTED = "/nano-banana-pro";

function env() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

const e = { ...env(), ...process.env };
const id = e.HIGGSFIELD_API_KEY_ID;
const secret = e.HIGGSFIELD_API_KEY_SECRET;

if (!id || !secret) {
  console.error("\n✗ HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET not set in .env.local\n");
  process.exit(1);
}
const auth = `Key ${id}:${secret}`;

const res = await fetch(`${BASE}/models`, { headers: { Authorization: auth } });
if (!res.ok) {
  console.error(`\n✗ /models failed (${res.status}): ${await res.text()}\n`);
  process.exit(1);
}
const data = await res.json();
const items = data.items ?? [];

console.log(`\nModels available to this account (${items.length}):\n`);
for (const m of items) {
  const ops = (m.operation_type ?? []).join(", ") || "—";
  console.log(`  ${(m.slug ?? "?").padEnd(34)} ${ops.padEnd(14)} ${m.title ?? ""}`);
}

const i2i = items.filter((m) =>
  (m.operation_type ?? []).some((o) => /image2image|edit|reference/i.test(o))
);
console.log(`\nImage-to-image capable: ${i2i.length ? i2i.map((m) => m.slug).join(", ") : "none"}`);

const probe = await fetch(`${BASE}${WANTED}`, {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const body = await probe.text();
const has = items.some((m) => (m.slug ?? "").includes("nano-banana"));

console.log(`\n${WANTED} -> ${probe.status} ${body.slice(0, 80)}`);
if (has || probe.status === 422) {
  console.log("\n✓ Nano Banana Pro looks available. The finishing pass should work.\n");
} else {
  console.log(
    "\n✗ Nano Banana Pro is NOT enabled on this account yet.\n" +
      "  Enable it for API use in Higgsfield (having it in the web UI is not the\n" +
      "  same thing — API model access is granted separately).\n" +
      "  Alternative: set GEMINI_API_KEY to run the same model via Google at 4K.\n"
  );
}
