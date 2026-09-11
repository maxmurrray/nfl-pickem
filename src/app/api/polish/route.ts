import { NextRequest, NextResponse } from "next/server";
import {
  availableProvider,
  checkHiggsfield,
  POLISH_PROMPT,
  startPolish,
} from "@/lib/polish";

export const dynamic = "force-dynamic";
// The finishing pass runs ~50s, plus retries when Google is busy. Vercel's
// default function ceiling is well under that.
export const maxDuration = 300;

/**
 * The finishing pass over the rendered picks board.
 *
 * Deliberately split into submit + poll rather than one long request: the
 * model takes one to two minutes, which is well past a serverless function's
 * ceiling. POST renders the board, hands it to the model and returns straight
 * away; the browser polls GET until it's done. Nothing here runs longer than a
 * few seconds.
 *
 *   POST /api/polish  { season, week, size }  -> { requestId } | { dataUri }
 *   GET  /api/polish?id=<requestId>           -> { status, url? }
 */

const ASPECT: Record<string, string> = {
  x: "4:5",
  square: "1:1",
  story: "9:16",
};

export async function POST(request: NextRequest) {
  const provider = availableProvider();
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "No image-model credentials configured. Add HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET (or GEMINI_API_KEY) to .env.local.",
      },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const season = Number(body?.season);
  const week = Number(body?.week);
  const size = typeof body?.size === "string" ? body.size : "x";
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    return NextResponse.json({ error: "Invalid season/week" }, { status: 400 });
  }
  if (!(size in ASPECT)) {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }

  // Render the real board first — same endpoint the download uses, so the model
  // is always finishing exactly what the user previewed.
  const boardUrl = new URL(
    `/api/graphic?season=${season}&week=${week}&size=${size}`,
    request.nextUrl.origin
  );
  const board = await fetch(boardUrl);
  if (!board.ok) {
    const detail = await board.json().catch(() => ({}));
    return NextResponse.json(
      { error: detail.error ?? "Couldn't render the board to finish." },
      { status: board.status }
    );
  }
  const png = Buffer.from(await board.arrayBuffer());

  try {
    const started = await startPolish(
      png,
      typeof body?.prompt === "string" && body.prompt.trim()
        ? body.prompt
        : POLISH_PROMPT,
      ASPECT[size]
    );

    // Gemini hands back a 4K PNG around 8MB, which is over X's 5MB PNG ceiling
    // and slow to shift through JSON. High-quality JPEG is half the size and
    // indistinguishable at feed scale — and X recompresses uploads regardless.
    if (started.dataUri?.startsWith("data:image/png")) {
      try {
        const sharp = (await import("sharp")).default;
        const raw = Buffer.from(started.dataUri.split(",")[1], "base64");
        const jpeg = await sharp(raw)
          .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
          .toBuffer();
        started.dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      } catch {
        // sharp unavailable — ship the PNG as-is
      }
    }
    return NextResponse.json(started);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Finishing pass failed." },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const status = await checkHiggsfield(id);
  return NextResponse.json(status);
}
