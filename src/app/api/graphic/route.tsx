import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { loadBackdrop } from "@/lib/backdrop";
import { getSeasonContext, getWeekGames } from "@/lib/espn";
import { emptyRecords, gradeWeek, type WinLoss } from "@/lib/grading";
import { getPicksForSeason, getPicksForWeek } from "@/lib/picks-store";
import { darken, needsDivider, teamCard, teamLogo } from "@/lib/teams";
import type { Game, GameSide, PlayerId, WeekPicks } from "@/lib/types";
import { PLAYER_IDS, PLAYER_NAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

/* ===========================================================================
   GRAPHIC CONFIG — every number here is in LOGICAL px against a 1080-wide
   canvas. The renderer multiplies by `scale` (2) for the exported file, so
   1080×1350 logical exports as 2160×2700.
   =========================================================================== */
const CONFIG = {
  bg: "#000000",

  // Weekdays (US Eastern) left off the graphic. The board gets posted on a
  // Friday, by which point nobody has picked Monday night yet — including it
  // would both show an empty column and, worse, trip the unpicked-game lock
  // below and refuse to render at all. The game itself is untouched: it stays
  // pickable on the site and still counts toward both records.
  hideDays: ["Mon"] as string[],

  safeInset: 86,
  gutter: 30,

  weightMatchup: 42,
  weightPick: 26,

  rowGap: 9,
  rowRadius: 11,
  rowHeightMax: 68,
  rowHeightMin: 40,

  blendDeg: 100, // matchup colour blend axis (100 = a soft near-vertical lean)
  blendSoft: 8, // half-width of the blend, as a % of card width
  logoBoxRatio: 0.80,
  atSize: 0.30, // "@" glyph size as a fraction of row height

  // Glass finish, matching the reference: bright rim, hard specular break
  // just past the middle, heavy shadow underneath so cards sit off the black.
  rimLight: 0.42,
  rimDark: 0.55,
  cardShadow: "0 6px 14px rgba(0,0,0,0.78)",
  emptyCard: "#171a1f",

  // Column rails — the thin bracket each stack of cards sits inside.
  railPad: 9,
  railRadius: 16,
  railBorder: 0.16,
  railFill: 0.05,

  headerSize: 62,
  headerGapBelow: 22,
  footerSize: 46,
  footerRowH: 58,
  footerGapAbove: 26,

  // Headers, footer labels and records are plain white. The black edge behind
  // them is invisible against the black background and only earns its keep if
  // a generated backdrop is installed.
  textFill: "#FFFFFF",
  outline: 3,
  outlineColor: "#000000",

  backdropScrim: 0.45,
  text: "#FFFFFF",
};
/* ========================================================================= */

// Heavy condensed display face, matching the broadcast look of the reference.
// Static TTF from the google/fonts repo — Satori can't use woff2 or variable
// fonts. Fetched once per server instance and passed to the renderer so the
// export never falls back to a system font mid-render.
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/anton/Anton-Regular.ttf";
const DISPLAY = "Anton";

type FontDef = {
  name: string;
  data: ArrayBuffer;
  weight: 400;
  style: "normal";
};
let fontCache: FontDef[] | null | undefined;

async function loadFonts(): Promise<FontDef[] | undefined> {
  if (fontCache !== undefined) return fontCache ?? undefined;
  try {
    const res = await fetch(FONT_URL, { next: { revalidate: 604800 } });
    if (!res.ok) throw new Error(`font ${res.status}`);
    fontCache = [
      {
        name: DISPLAY,
        data: await res.arrayBuffer(),
        weight: 400,
        style: "normal",
      },
    ];
  } catch {
    fontCache = null; // render with next/og's default rather than failing
  }
  return fontCache ?? undefined;
}

// 4:5 is the tallest portrait X shows uncropped in the timeline. `x` is the
// canonical export; the other two exist for Instagram and are the same layout
// on a different canvas.
const SIZES = {
  x: { w: 1080, h: 1350 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
} as const;
const SIZE_ALIASES: Record<string, keyof typeof SIZES> = { twitter: "x" };
const SCALE = 2;

type SizeKey = keyof typeof SIZES;

function resolveSize(value: string | null): SizeKey | null {
  if (!value) return null;
  const key = SIZE_ALIASES[value] ?? value;
  return key in SIZES ? (key as SizeKey) : null;
}

/* ---------------------------------------------------------------------------
   Logos. Satori ignores `filter: drop-shadow`, so the shadow is baked into the
   PNG with sharp before it ever reaches the renderer: blur the logo's alpha
   channel, tint it black, composite it underneath at an offset. That gives a
   shadow on the silhouette rather than a box shadow around the image.
   Baked at final display size so the blur radius is physically correct, and
   cached per (url, size) for the life of the server instance.
   --------------------------------------------------------------------------- */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Logos ship with the repo (scripts/fetch-logos.mjs). Fetching 26 of them from
// ESPN per render was fine locally and far too slow on a serverless function —
// it pushed this endpoint past its timeout in production.
const LOGO_DIR = path.join(process.cwd(), "public", "logos", "nfl");

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

/** Logo bytes: from disk, falling back to ESPN for a team we don't have. */
async function logoBuffer(side: GameSide): Promise<Buffer | null> {
  if (side.abbreviation) {
    try {
      return await readFile(path.join(LOGO_DIR, `${side.abbreviation}.png`));
    } catch {
      // not on disk — a relocation or a new abbreviation; fall through
    }
  }
  const url = teamLogo(side);
  return url ? fetchLogoBuffer(url) : null;
}

async function fetchLogoBuffer(url: string): Promise<Buffer | null> {
  for (const init of [
    { next: { revalidate: 86400 } },
    { cache: "no-store" },
  ] as RequestInit[]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || !buf.subarray(0, 4).equals(PNG_MAGIC)) continue;
      return buf;
    } catch {
      // fall through to the uncached retry
    }
  }
  return null;
}

/** Result of baking: the data URI and the exact box it should render at. */
export interface BakedLogo {
  uri: string;
  w: number;
  h: number;
}

/**
 * Size by HEIGHT, not into a square. Most NFL marks are wider than they are
 * tall, so fitting them into a square box collapses their height and they read
 * as tiny. Capping height at `artPx` and letting width run (to a sane limit)
 * gives every row the same visual weight, which is what the reference does.
 */
async function bakeLogo(
  source: Buffer,
  artPx: number
): Promise<BakedLogo | null> {
  const maxW = Math.round(artPx * 2.2);
  const sharp = await getSharp();
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

  // Spec shadows at logical scale: 0 4px 8px rgba(0,0,0,.45)
  //                            and 0 1px 2px rgba(0,0,0,.35)
  const shadows = [
    { dy: 4 * SCALE, blur: 8 * SCALE, alpha: 0.45 },
    { dy: 1 * SCALE, blur: 2 * SCALE, alpha: 0.35 },
  ];

  // A CSS blur radius r is about sigma r/2, and a gaussian is spent by 3 sigma.
  // The padding has to cover that fall-off PLUS the offset, otherwise the blur
  // runs into the edge of the bitmap and stops dead — which is what put a faint
  // rectangle around every logo.
  const maxSigma = Math.max(...shadows.map((s) => s.blur / 2));
  const maxDy = Math.max(...shadows.map((s) => s.dy));
  const pad = Math.ceil(maxSigma * 3 + maxDy + 2);

  if (!sharp) {
    return {
      uri: `data:image/png;base64,${source.toString("base64")}`,
      w: artPx,
      h: artPx,
    };
  }

  try {
    // ESPN's 500px logos carry a wide transparent margin, so resizing the raw
    // file leaves the artwork far smaller than the box. Trim that margin first
    // so every logo fills its box to the same visual weight, then size by
    // HEIGHT — most NFL marks are wider than tall, and fitting them into a
    // square collapses them to half the intended size.
    let trimmed = source;
    try {
      trimmed = await sharp(source).trim().png().toBuffer();
    } catch {
      // a logo that trims to nothing — keep the original
    }
    const art = await sharp(trimmed)
      .resize({ width: maxW, height: artPx, fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(art).metadata();
    const aw = meta.width ?? artPx;
    const ah = meta.height ?? artPx;
    const cw = aw + pad * 2;
    const ch = ah + pad * 2;

    const layers: { input: Buffer; top: number; left: number }[] = [];
    for (const { dy, blur, alpha } of shadows) {
      // Bake the drop offset into the padding so the blurred mask is already
      // the full canvas size and composites at the origin — no second shift
      // that could clip it.
      const offsetArt = await sharp(art)
        .extend({
          top: pad + dy,
          bottom: pad - dy,
          left: pad,
          right: pad,
          background: transparent,
        })
        .png()
        .toBuffer();
      const mask = await sharp(offsetArt)
        .extractChannel("alpha")
        .blur(Math.max(0.3, blur / 2))
        .linear(alpha, 0)
        .toBuffer();
      const layer = await sharp({
        create: { width: cw, height: ch, channels: 3, background: "#000" },
      })
        .joinChannel(mask)
        .png()
        .toBuffer();
      layers.push({ input: layer, top: 0, left: 0 });
    }
    layers.push({ input: art, top: pad, left: pad });

    const out = await sharp({
      create: { width: cw, height: ch, channels: 4, background: transparent },
    })
      .composite(layers)
      .png({ compressionLevel: 3 })
      .toBuffer();

    return {
      uri: `data:image/png;base64,${out.toString("base64")}`,
      w: cw,
      h: ch,
    };
  } catch {
    return {
      uri: `data:image/png;base64,${source.toString("base64")}`,
      w: artPx,
      h: artPx,
    };
  }
}

const bakeCache = new Map<string, BakedLogo | null>();

async function loadLogos(
  games: Game[],
  artPx: number
): Promise<Map<string, BakedLogo>> {
  const sides = new Map<string, GameSide>();
  for (const game of games) {
    for (const side of [game.away, game.home]) {
      if (side.abbreviation) sides.set(side.abbreviation, side);
    }
  }
  const out = new Map<string, BakedLogo>();
  await Promise.all(
    [...sides].map(async ([abbr, side]) => {
      const key = `${abbr}@${artPx}`;
      if (!bakeCache.has(key)) {
        const source = await logoBuffer(side);
        bakeCache.set(key, source ? await bakeLogo(source, artPx) : null);
      }
      const baked = bakeCache.get(key);
      if (baked) out.set(abbr, baked);
    })
  );
  return out;
}

/** Weekday abbreviation (Mon, Tue …) for a kickoff, in US Eastern. */
function kickoffDay(game: Game): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(game.kickoff));
}

/* ---------------------------------------------------------------------------
   Records
   --------------------------------------------------------------------------- */

type Records = Record<PlayerId, WinLoss>;

function emptyWL(): Records {
  return emptyRecords();
}

function formatWL(record: WinLoss | null): string {
  return record ? `${record.wins}-${record.losses}` : "—";
}

interface RecordSet {
  lastWeek: Records | null;
  season: Records;
}

/** Season totals plus the previous week's record, graded on the fly. */
async function buildRecords(
  season: number,
  week: number
): Promise<RecordSet> {
  const context = await getSeasonContext();
  const weekCount =
    season === context.season ? Math.max(context.currentWeek, week) : 18;
  const weekNumbers = Array.from({ length: weekCount }, (_, i) => i + 1);

  const [weeks, rows] = await Promise.all([
    Promise.all(weekNumbers.map((w) => getWeekGames(season, w))),
    getPicksForSeason(season),
  ]);

  const picksByWeek = new Map<number, WeekPicks>();
  for (const row of rows) {
    const weekPicks = picksByWeek.get(row.week) ?? {};
    (weekPicks[row.gameId] ??= {})[row.player] = row.teamId;
    picksByWeek.set(row.week, weekPicks);
  }

  const seasonTotals = emptyWL();
  let lastWeek: Records | null = null;

  for (const weekData of weeks) {
    const graded = gradeWeek(
      weekData.games,
      picksByWeek.get(weekData.week) ?? {}
    );
    for (const player of PLAYER_IDS) {
      seasonTotals[player].wins += graded[player].wins;
      seasonTotals[player].losses += graded[player].losses;
    }
    if (weekData.week === week - 1) lastWeek = graded;
  }

  return { lastWeek, season: seasonTotals };
}

/**
 * GET /api/graphic?season=2026&week=1&size=x
 *
 * PNG of both players' picks for the week, laid out as a broadcast-style
 * three-column board. Refuses to render while any game that HASN'T kicked off
 * is missing a pick, since that would leak one player's pick to the other;
 * once a game is locked both picks are public anyway, and a game nobody picked
 * renders as an empty slot.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = Number(params.get("season"));
  const week = Number(params.get("week"));
  const sizeKey = resolveSize(params.get("size") ?? "x");

  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    return NextResponse.json({ error: "Invalid season/week" }, { status: 400 });
  }
  if (!sizeKey) {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }

  const [{ games: allGames }, rows] = await Promise.all([
    getWeekGames(season, week),
    getPicksForWeek(season, week),
  ]);
  if (allGames.length === 0) {
    return NextResponse.json({ error: "No games this week" }, { status: 404 });
  }

  // Drop the hidden days from the BOARD only. Records are graded from the full
  // slate in buildRecords(), so a Monday result still moves both records even
  // though the game never appears here. Week 18 has no Monday game at all, and
  // a filter that emptied the slate would be worse than not filtering.
  const shown = allGames.filter((g) => !CONFIG.hideDays.includes(kickoffDay(g)));
  const games = shown.length > 0 ? shown : allGames;

  const picks: WeekPicks = {};
  for (const row of rows) {
    (picks[row.gameId] ??= {})[row.player] = row.teamId;
  }

  // Only games on the board can leak a pick, so an unpicked Monday night no
  // longer blocks Friday's graphic.
  const leaks = games.some(
    (game) =>
      game.state === "pre" &&
      PLAYER_IDS.some((player) => !picks[game.id]?.[player])
  );
  if (leaks) {
    return NextResponse.json(
      { error: "Both players must pick every upcoming game before the graphic unlocks." },
      { status: 409 }
    );
  }

  // ----- layout metrics, all derived from the canvas and the game count -----
  const u = (n: number) => Math.round(n * SCALE);
  const c = CONFIG;
  const W = SIZES[sizeKey].w * SCALE;
  const H = SIZES[sizeKey].h * SCALE;
  const n = games.length;

  const pad = u(c.safeInset);
  const contentW = W - pad * 2;
  const contentH = H - pad * 2;

  const gutter = u(c.gutter);
  const usable = contentW - gutter * 2;
  const totalWeight = c.weightMatchup + c.weightPick * 2;
  const pickW = Math.floor((usable * c.weightPick) / totalWeight);
  const matchupW = usable - pickW * 2;

  const headerFont = u(c.headerSize);
  const headerH = Math.round(headerFont * 1.12);
  const footerFont = u(c.footerSize);
  const footerRowH = u(c.footerRowH);
  const footerH = footerRowH * 2;

  const rowGap = u(c.rowGap);

  const radius = u(c.rowRadius);
  const railPad = u(c.railPad);
  const railEdge = Math.max(1, u(1));
  const railChrome = (railPad + railEdge) * 2; // rail padding on both axes

  // Cards sit inside the rails, so their width is the column minus the rail.
  const matchupCardW = matchupW - railChrome;
  const pickCardW = pickW - railChrome;

  const availRows =
    contentH -
    headerH -
    u(c.headerGapBelow) -
    u(c.footerGapAbove) -
    footerH -
    railChrome;
  const rowH = Math.max(
    u(c.rowHeightMin),
    Math.min(u(c.rowHeightMax), Math.floor((availRows - rowGap * (n - 1)) / n))
  );
  const rowsH = rowH * n + rowGap * (n - 1);
  const headerGap = u(c.headerGapBelow) + Math.max(0, availRows - rowsH);

  const artPx = Math.round(rowH * c.logoBoxRatio);

  const [logos, fonts, backdrop] = await Promise.all([
    loadLogos(games, artPx),
    loadFonts(),
    loadBackdrop(sizeKey, W, H).catch(() => null),
  ]);
  const records = await buildRecords(season, week);

  const pickedSide = (game: Game, player: PlayerId): GameSide | null => {
    const teamId = picks[game.id]?.[player];
    if (!teamId) return null;
    if (teamId === game.home.teamId) return game.home;
    if (teamId === game.away.teamId) return game.away;
    return null;
  };

  /* ---------------- render helpers ---------------- */

  const logoImg = (side: GameSide) => {
    const baked = logos.get(side.abbreviation);
    if (!baked) return null;
    return <img src={baked.uri} width={baked.w} height={baked.h} alt="" />;
  };

  // One glass finish reused by every card: bright across the top, a hard
  // specular break just past the middle, a gentle lift to the bottom. It's an
  // rgba overlay rather than baked-in colours so the same treatment works over
  // a solid pick colour and over a two-team blend alike.
  const GLOSS =
    "linear-gradient(180deg, rgba(255,255,255,0.36) 0%, rgba(255,255,255,0.13) 45%, rgba(0,0,0,0.34) 51%, rgba(0,0,0,0.02) 100%)";

  /**
   * Text with a hard black edge. Satori supports background-clip:text for the
   * metallic fill but silently drops textShadow on top of it, so the edge is
   * eight offset copies of the same word stacked behind the fill.
   */
  const outlined = (
    key: string,
    text: string,
    size: number,
    fill: string,
    edge: number,
    gradient = true
  ) => {
    const o = Math.max(1, edge);
    const ring = [
      [-o, 0], [o, 0], [0, -o], [0, o],
      [-o, -o], [o, -o], [-o, o], [o, o],
    ];
    const layer = (style: React.CSSProperties, k: string) => (
      <div
        key={k}
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
      >
        <span style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1, ...(style as any).__text }}>
          {text}
        </span>
      </div>
    );
    return (
      <div
        key={key}
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: Math.round(size * 1.3),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ring.map(([dx, dy], i) => (
          <div
            key={`${key}-o${i}`}
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `translate(${dx}px, ${dy}px)`,
            }}
          >
            <span
              style={{
                fontFamily: DISPLAY,
                fontSize: size,
                lineHeight: 1,
                color: c.outlineColor,
              }}
            >
              {text}
            </span>
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={
              (gradient
                ? {
                    fontFamily: DISPLAY,
                    fontSize: size,
                    lineHeight: 1,
                    backgroundImage: fill,
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }
                : {
                    fontFamily: DISPLAY,
                    fontSize: size,
                    lineHeight: 1,
                    color: fill,
                  }) as React.CSSProperties
            }
          >
            {text}
          </span>
        </div>
      </div>
    );
  };

  /** Rim lines that sell the glass edge: light on top, dark underneath. */
  const rim = (key: string) => [
    <div
      key={`${key}-rt`}
      style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: Math.max(1, u(1.5)),
        background: `rgba(255,255,255,${c.rimLight})`,
        display: "flex",
      }}
    />,
    <div
      key={`${key}-rb`}
      style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: Math.max(1, u(1)),
        background: `rgba(0,0,0,${c.rimDark})`,
        display: "flex",
      }}
    />,
  ];

  /**
   * Cards are built with a FLAT child list on purpose. Satori drops the
   * absolute positioning of anything wrapped in a React Fragment, which
   * silently pushes the logos into normal flow and off the card.
   */
  const matchupCard = (game: Game) => {
    const away = teamCard(game.away);
    const home = teamCard(game.home);
    const half = Math.round(matchupCardW / 2);
    const soft = c.blendSoft;
    // Two teams sharing a brand colour would read as one block, so those rows
    // get a dark seam instead of a soft blend.
    // Near-identical colours (New England and Seattle are the same navy) get a
    // soft crease rather than a hard rule — each side darkening into the middle
    // reads as a fold between two panels instead of a line drawn over the card.
    const image = needsDivider(away, home)
      ? `linear-gradient(${c.blendDeg}deg, ${away} 0%, ${away} 41%, ${darken(away, 0.45)} 49.4%, ${darken(home, 0.45)} 50.6%, ${home} 59%, ${home} 100%)`
      : `linear-gradient(${c.blendDeg}deg, ${away} 0%, ${away} ${50 - soft}%, ${home} ${50 + soft}%, ${home} 100%)`;

    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: matchupCardW,
          height: rowH,
          borderRadius: radius,
          overflow: "hidden",
          boxShadow: c.cardShadow,
          backgroundImage: image,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            display: "flex",
            backgroundImage: GLOSS,
          }}
        />
        {rim(`m-${game.id}`)}
        {[game.away, game.home].map((side, i) => (
          <div
            key={`${game.id}-${i}`}
            style={{
              position: "absolute",
              top: 0,
              left: i === 0 ? 0 : matchupCardW - half,
              width: half,
              height: rowH,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {logoImg(side)}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: matchupCardW,
            height: rowH,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {outlined(
            `at-${game.id}`,
            "@",
            Math.round(rowH * c.atSize),
            "#ffffff",
            Math.max(1, u(1.5)),
            false
          )}
        </div>
      </div>
    );
  };

  const pickCard = (game: Game, player: PlayerId) => {
    const side = pickedSide(game, player);
    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          width: pickCardW,
          height: rowH,
          borderRadius: radius,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: c.cardShadow,
          background: side ? teamCard(side) : c.emptyCard,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            display: "flex",
            backgroundImage: GLOSS,
          }}
        />
        {rim(`p-${game.id}-${player}`)}
        {side ? logoImg(side) : null}
      </div>
    );
  };

  const columnRail = (key: string, width: number, cards: React.ReactNode[]) => (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        padding: railPad,
        borderRadius: u(c.railRadius),
        border: `${railEdge}px solid rgba(255,255,255,${c.railBorder})`,
        background: `rgba(255,255,255,${c.railFill})`,
      }}
    >
      {cards}
    </div>
  );

  const stack = (build: (game: Game) => React.ReactNode) =>
    games.map((game, i) => (
      <div
        key={game.id}
        style={{ display: "flex", marginTop: i === 0 ? 0 : rowGap }}
      >
        {build(game)}
      </div>
    ));

  const footerRow = (label: string, values: Record<PlayerId, string>) => (
    <div
      key={label}
      style={{ display: "flex", width: contentW, height: footerRowH }}
    >
      <div style={{ width: matchupW, display: "flex", alignItems: "center" }}>
        {outlined(`fl-${label}`, label, footerFont, c.textFill, u(c.outline), false)}
      </div>
      {PLAYER_IDS.map((player) => (
        <div
          key={player}
          style={{
            width: pickW,
            marginLeft: gutter,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {outlined(
            `fv-${label}-${player}`,
            values[player],
            footerFont,
            c.textFill,
            u(c.outline),
            false
          )}
        </div>
      ))}
    </div>
  );

  const byPlayer = (fn: (p: PlayerId) => string): Record<PlayerId, string> => ({
    dad: fn("dad"),
    rich: fn("rich"),
  });

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: c.bg,
          padding: pad,
          fontFamily: DISPLAY,
        }}
      >
        {backdrop && (
          <img
            src={backdrop}
            width={W}
            height={H}
            alt=""
            style={{ position: "absolute", top: 0, left: 0 }}
          />
        )}
        {backdrop && (
          <div
            style={{
              position: "absolute",
              top: 0, left: 0, width: W, height: H,
              display: "flex",
              background: `rgba(0,0,0,${c.backdropScrim})`,
            }}
          />
        )}

        {/* Chrome column headers */}
        <div style={{ display: "flex", width: contentW, height: headerH }}>
          <div style={{ width: matchupW, display: "flex" }}>
            {outlined("h-week", `WEEK ${week}`, headerFont, c.textFill, u(c.outline), false)}
          </div>
          <div style={{ width: gutter, display: "flex" }} />
          <div style={{ width: pickW, display: "flex" }}>
            {outlined("h-dad", PLAYER_NAMES.dad.toUpperCase(), headerFont, c.textFill, u(c.outline), false)}
          </div>
          <div style={{ width: gutter, display: "flex" }} />
          <div style={{ width: pickW, display: "flex" }}>
            {outlined("h-rich", PLAYER_NAMES.rich.toUpperCase(), headerFont, c.textFill, u(c.outline), false)}
          </div>
        </div>

        {/* Three railed columns, locked row-for-row */}
        <div style={{ display: "flex", width: contentW, marginTop: headerGap }}>
          {columnRail("rail-m", matchupW, stack((game) => matchupCard(game)))}
          <div style={{ width: gutter, display: "flex" }} />
          {columnRail("rail-dad", pickW, stack((game) => pickCard(game, "dad")))}
          <div style={{ width: gutter, display: "flex" }} />
          {columnRail("rail-rich", pickW, stack((game) => pickCard(game, "rich")))}
        </div>

        {/* Footer stat block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: contentW,
            marginTop: u(c.footerGapAbove),
          }}
        >
          {footerRow("LAST WEEK", byPlayer((p) => formatWL(records.lastWeek?.[p] ?? null)))}
          {footerRow("SEASON RECORD", byPlayer((p) => formatWL(records.season[p])))}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts,
      headers: {
        "cache-control": "no-store, max-age=0, must-revalidate",
      },
    }
  );
}
