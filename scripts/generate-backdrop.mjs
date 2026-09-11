#!/usr/bin/env node
/**
 * Generate the picks-graphic backdrop with Nano Banana Pro (Gemini 3 Pro
 * Image), steered by a reference image.
 *
 *   node scripts/generate-backdrop.mjs --reference ~/Desktop/ref.png
 *   node scripts/generate-backdrop.mjs --reference ref.png --size x --aspect 4:5
 *   node scripts/generate-backdrop.mjs --reference ref.png --prompt "..." --dry-run
 *
 * This is ART ONLY, and it runs by hand — not on a schedule and not in the
 * request path. The weekly graphic composites the real rows, logos and picks
 * on top of whatever this writes, straight from Supabase, so a model can never
 * put Rich on the wrong team or redraw a logo wrong. Run it once, commit the
 * PNG, and the weekly export needs no API key, no network call and no money.
 *
 * Writes public/graphic/backdrop-<size>.png (or backdrop.png for every canvas).
 * Needs GEMINI_API_KEY in .env.local.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "public", "graphic");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3-pro-image";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * The board is drawn on top of this, so the art has to stay out of its own
 * way: the centre needs to read as a calm, dark surface or the rows stop being
 * legible. That constraint is most of the prompt.
 */
const DEFAULT_PROMPT = `A premium broadcast-style graphic BACKDROP for an NFL weekly picks board, in the visual style of the attached reference image.

CRITICAL CONSTRAINTS:
- Produce ONLY background artwork. No text, no letters, no numbers, no words anywhere.
- No team logos, no helmets, no players, no scoreboard rows, no tables, no grids of cards.
- The centre 80% of the frame must stay a calm, dark, near-uniform surface with very low detail and no bright spots — a board of coloured cards will be composited on top of it and must remain fully legible.
- Put any visual interest at the extreme outer edges only: a subtle vignette, a soft atmospheric glow, faint stadium-light haze, gentle film grain.
- Deep blacks, rich contrast, cinematic and restrained. Nothing busy, nothing neon, no gradients that read as stripes.
- Portrait orientation.`;

function parseArgs(argv) {
  const args = { size: null, aspect: "4:5", imageSize: "4K", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reference" || a === "-r") args.reference = argv[++i];
    else if (a === "--prompt" || a === "-p") args.prompt = argv[++i];
    else if (a === "--size" || a === "-s") args.size = argv[++i];
    else if (a === "--aspect") args.aspect = argv[++i];
    else if (a === "--resolution") args.imageSize = argv[++i];
    else if (a === "--out" || a === "-o") args.out = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!args.reference) args.reference = a;
  }
  return args;
}

function readEnv() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.reference) {
  console.log(`
Generate the picks-graphic backdrop with Nano Banana Pro.

  --reference, -r   PATH   reference image to steer the style (required)
  --prompt, -p      TEXT   override the built-in prompt
  --size, -s        KEY    x | square | story — writes backdrop-<key>.png
                           (omit to write backdrop.png, used by every canvas)
  --aspect          RATIO  default 4:5
  --resolution      SIZE   1K | 2K | 4K (default 4K)
  --out, -o         PATH   explicit output path
  --dry-run                print the request and exit, calling nothing

Needs GEMINI_API_KEY in .env.local.
`);
  process.exit(args.help ? 0 : 1);
}

if (!existsSync(args.reference)) fail(`Reference image not found: ${args.reference}`);

const ext = extname(args.reference).toLowerCase();
const mime = MIME[ext];
if (!mime) fail(`Unsupported reference type "${ext}". Use png, jpg or webp.`);

const prompt = args.prompt ?? DEFAULT_PROMPT;
const out =
  args.out ?? join(OUT_DIR, args.size ? `backdrop-${args.size}.png` : "backdrop.png");

const body = {
  model: MODEL,
  input: [
    { type: "text", text: prompt },
    {
      type: "image",
      mime_type: mime,
      data: readFileSync(args.reference).toString("base64"),
    },
  ],
  response_format: {
    type: "image",
    mime_type: "image/png",
    aspect_ratio: args.aspect,
    image_size: args.imageSize,
  },
};

console.log(`model      ${MODEL}`);
console.log(`reference  ${args.reference} (${mime})`);
console.log(`output     ${out}`);
console.log(`aspect     ${args.aspect} @ ${args.imageSize}`);
console.log(`prompt     ${prompt.split("\n")[0].slice(0, 70)}…`);

if (args.dryRun) {
  console.log("\n--dry-run: nothing sent.\n");
  process.exit(0);
}

const key = readEnv().GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
if (!key) {
  fail(
    "GEMINI_API_KEY is not set.\n  Add it to .env.local (it is gitignored) or export it in your shell.\n  Get one at https://aistudio.google.com/apikey"
  );
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": key },
  body: JSON.stringify(body),
});

if (!res.ok) {
  fail(`Gemini request failed (${res.status}):\n${(await res.text()).slice(0, 800)}`);
}

const data = await res.json();

// Be liberal about where the bytes turn up — this response shape is young and
// has already moved once.
const b64 =
  data?.interaction?.output_image?.data ??
  data?.output_image?.data ??
  data?.output?.find?.((o) => o?.type === "image")?.data ??
  data?.candidates?.[0]?.content?.parts?.find((p) => p?.inline_data?.data)
    ?.inline_data?.data ??
  data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data)
    ?.inlineData?.data;

if (!b64) {
  fail(
    `No image in the response. Top-level keys: ${Object.keys(data ?? {}).join(", ") || "(none)"}\n` +
      JSON.stringify(data).slice(0, 800)
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const bytes = Buffer.from(b64, "base64");
writeFileSync(out, bytes);
console.log(`\n✓ wrote ${out} (${(bytes.length / 1048576).toFixed(2)} MB)`);
console.log("  Re-render the graphic to see it behind the board.\n");
