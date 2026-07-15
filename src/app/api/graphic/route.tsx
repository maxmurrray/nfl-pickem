import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { getWeekGames } from "@/lib/espn";
import { getPicksForWeek } from "@/lib/picks-store";
import type { Game, PlayerId, WeekPicks } from "@/lib/types";
import { PLAYER_IDS, PLAYER_NAMES } from "@/lib/types";

export const dynamic = "force-dynamic";

// v1 style: dark field-green board, two pick columns. Iterate later.
const SIZES = {
  twitter: { width: 1600, height: 900, columns: 2 },
  square: { width: 1080, height: 1080, columns: 2 },
  story: { width: 1080, height: 1920, columns: 1 },
} as const;

type SizeKey = keyof typeof SIZES;

function isSizeKey(value: string | null): value is SizeKey {
  return value !== null && value in SIZES;
}

const PLAYER_COLORS: Record<PlayerId, string> = {
  dad: "#4ade80",
  rich: "#7dd3fc",
};

async function loadLogos(games: Game[]): Promise<Map<string, string>> {
  const urls = new Set<string>();
  for (const game of games) {
    if (game.away.logo) urls.add(game.away.logo);
    if (game.home.logo) urls.add(game.home.logo);
  }
  const entries = await Promise.all(
    [...urls].map(async (url): Promise<[string, string]> => {
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) return [url, ""];
      const buf = Buffer.from(await res.arrayBuffer());
      return [url, `data:image/png;base64,${buf.toString("base64")}`];
    })
  );
  return new Map(entries.filter(([, uri]) => uri !== ""));
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

  const logos = await loadLogos(games);
  const logo = (side: Game["home"]) =>
    side.logo ? (logos.get(side.logo) ?? null) : null;
  const pickedSide = (game: Game, player: PlayerId) => {
    const teamId = picks[game.id]?.[player];
    return teamId === game.home.teamId ? game.home : game.away;
  };

  // Split games into columns, filling top-to-bottom, left column first.
  const perColumn = Math.ceil(games.length / size.columns);
  const columns: Game[][] = [];
  for (let i = 0; i < size.columns; i++) {
    columns.push(games.slice(i * perColumn, (i + 1) * perColumn));
  }

  const scale = size.columns === 1 ? 1 : size.width / 1600;
  const logoPx = Math.round(44 * Math.max(scale, 0.7));
  const abbrPx = Math.round(26 * Math.max(scale, 0.75));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundImage: "linear-gradient(160deg, #07130b, #0d2415)",
          color: "#f2f7f2",
          fontFamily: "sans-serif",
          padding: `${Math.round(36 * scale) + 8}px ${Math.round(48 * scale) + 8}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ fontSize: Math.round(52 * scale) + 10, fontWeight: 700 }}>
              DAD{" "}
              <span style={{ color: "#4ade80", margin: "0 14px" }}>vs</span>
              {" "}RICH
            </span>
          </div>
          <span
            style={{
              fontSize: Math.round(30 * scale) + 6,
              color: "#9fb3a4",
            }}
          >
            Week {week} · {season} NFL Picks
          </span>
        </div>

        <div style={{ display: "flex", flex: 1, gap: Math.round(40 * scale) }}>
          {columns.map((columnGames, columnIndex) => (
            <div
              key={columnIndex}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 0,
                  paddingBottom: 6,
                  borderBottom: "2px solid rgba(255,255,255,0.25)",
                }}
              >
                {PLAYER_IDS.map((player) => (
                  <span
                    key={player}
                    style={{
                      width: 120 * Math.max(scale, 0.8),
                      textAlign: "center",
                      justifyContent: "center",
                      display: "flex",
                      fontSize: Math.round(22 * scale) + 4,
                      fontWeight: 700,
                      letterSpacing: 2,
                      color: PLAYER_COLORS[player],
                    }}
                  >
                    {PLAYER_NAMES[player].toUpperCase()}
                  </span>
                ))}
              </div>

              {columnGames.map((game) => (
                <div
                  key={game.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                    borderBottom: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                    }}
                  >
                    {logo(game.away) && (
                      <img
                        src={logo(game.away)!}
                        width={logoPx}
                        height={logoPx}
                      />
                    )}
                    <span style={{ fontSize: abbrPx, fontWeight: 700 }}>
                      {game.away.abbreviation}
                    </span>
                    <span
                      style={{
                        fontSize: Math.round(abbrPx * 0.72),
                        color: "#9fb3a4",
                      }}
                    >
                      @
                    </span>
                    {logo(game.home) && (
                      <img
                        src={logo(game.home)!}
                        width={logoPx}
                        height={logoPx}
                      />
                    )}
                    <span style={{ fontSize: abbrPx, fontWeight: 700 }}>
                      {game.home.abbreviation}
                    </span>
                  </div>

                  {PLAYER_IDS.map((player) => {
                    const side = pickedSide(game, player);
                    return (
                      <div
                        key={player}
                        style={{
                          width: 120 * Math.max(scale, 0.8),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        {logo(side) && (
                          <img src={logo(side)!} width={logoPx} height={logoPx} />
                        )}
                        <span
                          style={{
                            fontSize: Math.round(abbrPx * 0.85),
                            fontWeight: 700,
                            color: PLAYER_COLORS[player],
                          }}
                        >
                          {side.abbreviation}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: size.width, height: size.height }
  );
}
