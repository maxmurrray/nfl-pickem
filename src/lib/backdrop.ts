import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Optional generated artwork sitting behind the picks board.
 *
 * The split is deliberate: the backdrop is ART and the board is DATA. Art is
 * generated once (scripts/generate-backdrop.mjs, via Nano Banana Pro) and
 * committed as a static file; the rows, logos and picks are always drawn from
 * Supabase on top of it. That way the graphic can look generated without any
 * chance of a model redrawing a logo wrong or putting Rich on the wrong team.
 *
 * Drop a file at public/graphic/backdrop.png (or backdrop-x.png /
 * -square.png / -story.png to vary by canvas). With no file present the board
 * renders on flat black exactly as before.
 */

const DIR = path.join(process.cwd(), "public", "graphic");

// Re-encoded to JPEG at canvas size: a 4K PNG as a base64 data URI is tens of
// megabytes of string for the renderer to parse, and it sits behind opaque
// cards anyway.
const QUALITY = 86;

const cache = new Map<string, string | null>();

let sharpModule: any;
async function getSharp(): Promise<any | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import("sharp")).default;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

async function readFirst(names: string[]): Promise<Buffer | null> {
  for (const name of names) {
    try {
      return await readFile(path.join(DIR, name));
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Backdrop for one canvas as a data URI, cropped to fill exactly, or null when
 * no artwork is installed.
 */
export async function loadBackdrop(
  sizeKey: string,
  width: number,
  height: number
): Promise<string | null> {
  const key = `${sizeKey}@${width}x${height}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const source = await readFirst([
    `backdrop-${sizeKey}.png`,
    `backdrop-${sizeKey}.jpg`,
    "backdrop.png",
    "backdrop.jpg",
  ]);
  if (!source) {
    cache.set(key, null);
    return null;
  }

  const sharp = await getSharp();
  if (!sharp) {
    cache.set(key, null);
    return null;
  }

  try {
    const fitted = await sharp(source)
      .resize(width, height, { fit: "cover", position: "centre" })
      .jpeg({ quality: QUALITY })
      .toBuffer();
    const uri = `data:image/jpeg;base64,${fitted.toString("base64")}`;
    cache.set(key, uri);
    return uri;
  } catch {
    cache.set(key, null);
    return null;
  }
}
