import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { getSeasonContext, getWeekGames } from "@/lib/espn";
import {
  addRecords,
  emptyRecords,
  formatRecord,
  gradeWeek,
} from "@/lib/grading";
import { getPicksForSeason, getPicksForWeek } from "@/lib/picks-store";
import type { Game, GameSide, PlayerId, WeekPicks } from "@/lib/types";
import { PLAYER_IDS, PLAYER_NAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

// Banner-style board: one game column on the left, a pick banner column
// per player. Tall formats suit this layout; X/Twitter shows 4:5 in full.
const SIZES = {
  twitter: { width: 1600, height: 2000 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
} as const;

type SizeKey = keyof typeof SIZES;

function isSizeKey(value: string | null): value is SizeKey {
  return value !== null && value in SIZES;
}

// Teams whose primary logo disappears against their own team color;
// ESPN's "-dark" variants are the white-on-transparent versions.
const WHITE_LOGO_TEAMS = new Set(["NYG", "NYJ", "LAR"]);

function logoUrl(side: GameSide): string | null {
  if (!side.logo) return null;
  return WHITE_LOGO_TEAMS.has(side.abbreviation)
    ? side.logo.replace("/nfl/500/", "/nfl/500-dark/")
    : side.logo;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function fetchLogo(url: string): Promise<string> {
  // First try the Next data cache; a failed or truncated response can
  // itself get cached, so validate the bytes and retry straight to the
  // network if they don't look like a PNG.
  for (const init of [
    { next: { revalidate: 86400 } },
    { cache: "no-store" },
  ] as RequestInit[]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || !buf.subarray(0, 4).equals(PNG_MAGIC)) continue;
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      // fall through to the uncached retry
    }
  }
  return "";
}

async function loadLogos(games: Game[]): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const game of games) {
    const away = logoUrl(game.away);
    const home = logoUrl(game.home);
    if (away) urls.add(away);
    if (home) urls.add(home);
  }
  const entries = await Promise.all(
    [...urls].map(async (url): Promise<[string, string]> => [
      url,
      await fetchLogo(url),
    ])
  );
  return new Map(entries.filter(([, uri]) => uri !== ""));
}

/** Season-to-date records for both players (completed games only). */
async function seasonRecords(season: number) {
  const context = await getSeasonContext();
  const weekCount = season === context.season ? context.currentWeek : 18;
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
  const totals = emptyRecords();
  for (const weekData of weeks) {
    addRecords(
      totals,
      gradeWeek(weekData.games, picksByWeek.get(weekData.week) ?? {})
    );
  }
  return totals;
}

/**
 * GET /api/graphic?season=2026&week=1&size=twitter
 *
 * PNG of both players' picks for the week. Only available once BOTH
 * players have picked every game (server-enforced), since it reveals
 * all picks.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = Number(params.get("season"));
  const week = Number(params.get("week"));
  const sizeParam = params.get("size") ?? "twitter";

  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    return NextResponse.json({ error: "Invalid season/week" }, { status: 400 });
  }
  if (!isSizeKey(sizeParam)) {
    return NextResponse.json({ error: "Invalid size" }, { status: 400 });
  }
  const size = SIZES[sizeParam];

  const [{ games }, rows] = await Promise.all([
    getWeekGames(season, week),
    getPicksForWeek(season, week),
  ]);
  if (games.length === 0) {
    return NextResponse.json({ error: "No games this week" }, { status: 404 });
  }

  const picks: WeekPicks = {};
  for (const row of rows) {
    (picks[row.gameId] ??= {})[row.player] = row.teamId;
  }

  const incomplete = games.some((game) =>
    PLAYER_IDS.some((player) => !picks[game.id]?.[player])
  );
  if (incomplete) {
    return NextResponse.json(
      { error: "Both players must pick every game before the graphic unlocks." },
      { status: 409 }
    );
  }

  const [logos, records] = await Promise.all([
    loadLogos(games),
    seasonRecords(season),
  ]);

  const pickedSide = (game: Game, player: PlayerId): GameSide => {
    const teamId = picks[game.id]?.[player];
    return teamId === game.home.teamId ? game.home : game.away;
  };

  // ----- layout metrics, all derived from canvas + game count -----
  const { width: W, height: H } = size;
  const n = games.length;
  const pad = Math.round(W * 0.03);
  const gap = Math.max(4, Math.round(H * 0.005));
  const headerH = Math.round(H * 0.085);
  const rowH = Math.floor((H - pad * 2 - headerH - gap * n) / n);
  const seam = 3;
  const rectW = Math.round(rowH * 1.5);
  const matchW = rectW * 2 + seam;
  const colGap = Math.max(10, Math.round(W * 0.015));
  const pickW = Math.floor((W - pad * 2 - matchW - colGap * 2) / 2);
  const logoSize = Math.round(rowH * 1.45);
  const badgeW = Math.round(rowH * 0.56);
  const badgeH = Math.round(rowH * 0.4);
  const nameFont = Math.round(Math.min(headerH * 0.42, pickW * 0.14));
  const recordFont = Math.round(nameFont * 0.72);
  const weekFont = Math.round(Math.min(headerH * 0.42, matchW * 0.19));

  // A team banner: primary-color rectangle with the logo blown up past
  // the rect's height and cropped, like broadcast pick boards.
  const teamRect = (side: GameSide, width: number) => {
    const url = logoUrl(side);
    const uri = url ? logos.get(url) : undefined;
    return (
      <div
        style={{
          width,
          height: rowH,
          background: side.color ? `#${side.color}` : "#374151",
          overflow: "hidden",
          position: "relative",
          display: "flex",
        }}
      >
        {uri && (
          <img
            src={uri}
            width={logoSize}
            height={logoSize}
            style={{
              position: "absolute",
              left: Math.round((width - logoSize) / 2),
              top: Math.round((rowH - logoSize) / 2),
            }}
          />
        )}
      </div>
    );
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#07090d",
          fontFamily: "sans-serif",
          padding: pad,
        }}
      >
        <div
          style={{
            display: "flex",
            height: headerH,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: matchW,
              display: "flex",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: weekFont,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            WEEK {week}
          </div>
          <div style={{ width: colGap, display: "flex" }} />
          {PLAYER_IDS.map((player, i) => (
            <div
              key={player}
              style={{
                width: pickW,
                marginLeft: i === 0 ? 0 : colGap,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  color: "#ffffff",
                  fontSize: nameFont,
                  fontWeight: 700,
                  letterSpacing: 4,
                }}
              >
                {PLAYER_NAMES[player].toUpperCase()}
              </span>
              <span
                style={{
                  color: "#9aa4b2",
                  fontSize: recordFont,
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                {formatRecord(records[player])}
              </span>
            </div>
          ))}
        </div>

        {games.map((game) => (
          <div key={game.id} style={{ display: "flex", marginTop: gap }}>
            <div
              style={{
                display: "flex",
                position: "relative",
                width: matchW,
              }}
            >
              {teamRect(game.away, rectW)}
              <div style={{ width: seam, display: "flex" }} />
              {teamRect(game.home, rectW)}
              <div
                style={{
                  position: "absolute",
                  left: Math.round(rectW + seam / 2 - badgeW / 2),
                  top: Math.round((rowH - badgeH) / 2),
                  width: badgeW,
                  height: badgeH,
                  background: "#ffffff",
                  color: "#0b0d12",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: Math.round(badgeH * 0.58),
                  fontWeight: 700,
                  borderRadius: 4,
                }}
              >
                AT
              </div>
            </div>
            <div style={{ width: colGap, display: "flex" }} />
            {teamRect(pickedSide(game, "dad"), pickW)}
            <div style={{ width: colGap, display: "flex" }} />
            {teamRect(pickedSide(game, "rich"), pickW)}
          </div>
        ))}
      </div>
    ),
    { width: W, height: H }
  );
}
