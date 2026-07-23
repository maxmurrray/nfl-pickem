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

/* ===========================================================================
   GRAPHIC CONFIG — tweak everything here. (Lives at the top of
   src/app/api/graphic/route.tsx.)
   =========================================================================== */
const CONFIG = {
  // "A" = two columns of games side-by-side (preferred, ~4:5).
  // "B" = single column grouped by day labels (THU / SUN / MON).
  columnMode: "A" as "A" | "B",

  // One accent for the whole graphic — NOT team colors. Try electric blue "#38bdf8".
  accent: "#e5b84b", // gold

  bgTop: "#0a0c10", // subtle vertical gradient, top …
  bgBottom: "#12151c", // … to bottom
  card: "#161a21", // neutral card surface (a hair lighter than the bg)
  chip: "#1d222b", // pick-chip surface (a hair lighter than the card)
  cardBorder: "rgba(255,255,255,0.07)", // hairline

  stripeWidth: 4, // px team-color edge stripe on each pick chip (@1600w, scales)
  padScale: 0.034, // outer padding as a fraction of width (~54px @ 1600w)

  textPrimary: "rgba(255,255,255,0.92)", // never pure white
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.38)",
};
/* ========================================================================= */

// Broadcast-style pairing: Barlow Condensed (display / abbreviations) + Barlow
// (clean sans). Static TTFs from the google/fonts repo so Satori can embed them
// (it can't use woff2 / variable fonts). Fetched once, cached, and passed to the
// renderer so the export never falls back to a system font mid-render.
const FONT_FILES = {
  cond700:
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/barlowcondensed/BarlowCondensed-Bold.ttf",
  sans400:
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/barlow/Barlow-Regular.ttf",
  sans500:
    "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/barlow/Barlow-Medium.ttf",
};
const DISPLAY = "Barlow Condensed";
const SANS = "Barlow";

type FontDef = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: "normal";
};
let fontCache: FontDef[] | null | undefined;

async function loadFonts(): Promise<FontDef[] | undefined> {
  if (fontCache !== undefined) return fontCache ?? undefined;
  try {
    const grab = async (url: string) => {
      const res = await fetch(url, { next: { revalidate: 604800 } });
      if (!res.ok) throw new Error(`font ${res.status}`);
      return res.arrayBuffer();
    };
    const [c7, s4, s5] = await Promise.all([
      grab(FONT_FILES.cond700),
      grab(FONT_FILES.sans400),
      grab(FONT_FILES.sans500),
    ]);
    fontCache = [
      { name: DISPLAY, data: c7, weight: 700, style: "normal" },
      { name: SANS, data: s4, weight: 400, style: "normal" },
      { name: SANS, data: s5, weight: 500, style: "normal" },
    ];
  } catch {
    // Fonts unavailable → render with next/og's built-in default so the export
    // still succeeds (just without the condensed display face).
    fontCache = null;
  }
  return fontCache ?? undefined;
}

const SIZES = {
  twitter: { width: 1600, height: 2000 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
} as const;

type SizeKey = keyof typeof SIZES;

function isSizeKey(value: string | null): value is SizeKey {
  return value !== null && value in SIZES;
}

// Teams whose primary logo is low-contrast on a dark card; ESPN's "-dark"
// variants are the white-on-transparent versions.
const WHITE_LOGO_TEAMS = new Set(["NYG", "NYJ", "LAR"]);

function logoUrl(side: GameSide): string | null {
  if (!side.logo) return null;
  return WHITE_LOGO_TEAMS.has(side.abbreviation)
    ? side.logo.replace("/nfl/500/", "/nfl/500-dark/")
    : side.logo;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function fetchLogo(url: string): Promise<string> {
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

/** Day label (THU / SUN / MON …) in US Eastern — used only in column mode B. */
function groupByDay(games: Game[]): { label: string; games: Game[] }[] {
  const order: string[] = [];
  const map = new Map<string, Game[]>();
  for (const g of games) {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    })
      .format(new Date(g.kickoff))
      .toUpperCase();
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(g);
  }
  return order.map((label) => ({ label, games: map.get(label)! }));
}

/**
 * GET /api/graphic?season=2026&week=1&size=twitter
 *
 * PNG of both players' picks for the week. Only available once BOTH players
 * have picked every game (server-enforced), since it reveals all picks.
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

  const [logos, records, fonts] = await Promise.all([
    loadLogos(games),
    seasonRecords(season),
    loadFonts(),
  ]);

  const pickedSide = (game: Game, player: PlayerId): GameSide => {
    const teamId = picks[game.id]?.[player];
    return teamId === game.home.teamId ? game.home : game.away;
  };

  const c = CONFIG;
  const leader =
    records.dad.wins > records.rich.wins
      ? "dad"
      : records.rich.wins > records.dad.wins
        ? "rich"
        : null;

  // ----- layout metrics (all derived from canvas + game count) -----
  const { width: W, height: H } = size;
  const n = games.length;
  const s = W / 1600; // scale factor vs. the 1600-wide reference
  const pad = Math.round(W * c.padScale);
  const contentW = W - pad * 2;

  const titleFont = Math.round(82 * s);
  const seasonFont = Math.round(22 * s);
  const badgeName = Math.round(30 * s);
  const badgeRec = Math.round(26 * s);

  const headerH = Math.round(H * 0.1);
  const ruleGap = Math.round(H * 0.012);
  const ruleH = Math.max(4, Math.round(6 * s));
  const bodyGap = Math.round(H * 0.02);
  const footerGap = Math.round(H * 0.014);
  const footerH = Math.round(H * 0.032);
  const bodyH =
    H - pad * 2 - headerH - ruleGap - ruleH - bodyGap - footerGap - footerH;

  const cols = c.columnMode === "A" ? 2 : 1;
  const colGap = cols === 2 ? Math.round(contentW * 0.028) : 0;
  const colW = Math.round((contentW - colGap * (cols - 1)) / cols);
  const rowsPerCol = cols === 2 ? Math.ceil(n / 2) : n;
  const cardGap = Math.max(8, Math.round(bodyH * 0.013));
  const dayGroups = groupByDay(games);
  const labelH = Math.round(bodyH * 0.032);

  const cardH =
    cols === 2
      ? Math.floor((bodyH - cardGap * (rowsPerCol - 1)) / rowsPerCol)
      : Math.floor(
          (bodyH -
            cardGap * (n - 1) -
            dayGroups.length * (labelH + cardGap)) /
            n
        );

  const stripeW = Math.max(3, Math.round(c.stripeWidth * s));
  const miniLogo = Math.round(cardH * 0.36);
  const miniAbbr = Math.round(cardH * 0.21);
  const atFont = Math.round(cardH * 0.18);
  const chipH = Math.round(cardH * 0.44);
  const chipLogo = Math.round(chipH * 0.6);
  const chipAbbr = Math.round(chipH * 0.4);
  const ownerFont = Math.round(cardH * 0.15);
  const cardRadius = Math.round(12 * s);
  const chipRadius = Math.round(8 * s);
  const cardPadX = Math.round(cardH * 0.16);

  const genDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  // ---------- render helpers ----------
  const teamMini = (side: GameSide) => {
    const url = logoUrl(side);
    const uri = url ? logos.get(url) : undefined;
    return (
      <div style={{ display: "flex", alignItems: "center" }}>
        {uri ? (
          <img src={uri} width={miniLogo} height={miniLogo} />
        ) : (
          <div style={{ width: miniLogo, height: miniLogo, display: "flex" }} />
        )}
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: miniAbbr,
            color: c.textPrimary,
            marginLeft: Math.round(7 * s),
            letterSpacing: 0.5,
          }}
        >
          {side.abbreviation}
        </span>
      </div>
    );
  };

  const pickChip = (side: GameSide) => {
    const url = logoUrl(side);
    const uri = url ? logos.get(url) : undefined;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          position: "relative",
          overflow: "hidden",
          height: chipH,
          background: c.chip,
          border: `1px solid ${c.cardBorder}`,
          borderRadius: chipRadius,
          paddingLeft: stripeW + Math.round(8 * s),
          paddingRight: Math.round(10 * s),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: stripeW,
            background: side.color ? `#${side.color}` : "#4b5563",
            display: "flex",
          }}
        />
        {uri && <img src={uri} width={chipLogo} height={chipLogo} />}
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: chipAbbr,
            color: c.textPrimary,
            marginLeft: Math.round(7 * s),
            letterSpacing: 0.5,
          }}
        >
          {side.abbreviation}
        </span>
      </div>
    );
  };

  const pickGroup = (game: Game, player: PlayerId, first: boolean) => (
    <div
      key={player}
      style={{
        display: "flex",
        alignItems: "center",
        marginLeft: first ? Math.round(14 * s) : Math.round(11 * s),
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: ownerFont,
          color: c.textMuted,
          marginRight: Math.round(6 * s),
        }}
      >
        {PLAYER_NAMES[player][0].toUpperCase()}
      </span>
      {pickChip(pickedSide(game, player))}
    </div>
  );

  const gameCard = (game: Game, marginTop: number) => (
    <div
      key={game.id}
      style={{
        display: "flex",
        alignItems: "center",
        height: cardH,
        marginTop,
        background: c.card,
        border: `1px solid ${c.cardBorder}`,
        borderRadius: cardRadius,
        paddingLeft: cardPadX,
        paddingRight: cardPadX,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flex: "1 1 0",
          minWidth: 0,
        }}
      >
        {teamMini(game.away)}
        <span
          style={{
            fontFamily: SANS,
            fontWeight: 400,
            fontSize: atFont,
            color: c.textMuted,
            marginLeft: Math.round(8 * s),
            marginRight: Math.round(8 * s),
          }}
        >
          @
        </span>
        {teamMini(game.home)}
      </div>
      {pickGroup(game, "dad", true)}
      {pickGroup(game, "rich", false)}
    </div>
  );

  // Body — mode A: two columns; mode B: one column with day labels.
  let body: React.ReactNode;
  if (cols === 2) {
    const columns = [
      games.slice(0, rowsPerCol),
      games.slice(rowsPerCol),
    ];
    body = (
      <div style={{ display: "flex", height: bodyH, width: contentW }}>
        {columns.map((colGames, ci) => (
          <div
            key={ci}
            style={{
              display: "flex",
              flexDirection: "column",
              width: colW,
              marginLeft: ci === 0 ? 0 : colGap,
            }}
          >
            {colGames.map((game, ri) => gameCard(game, ri === 0 ? 0 : cardGap))}
          </div>
        ))}
      </div>
    );
  } else {
    let firstBlock = true;
    body = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: bodyH,
          width: contentW,
        }}
      >
        {dayGroups.map((group) => {
          const block = (
            <div key={group.label} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: labelH,
                  marginTop: firstBlock ? 0 : cardGap,
                }}
              >
                <span
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 700,
                    fontSize: Math.round(labelH * 0.62),
                    letterSpacing: 3,
                    color: c.textSecondary,
                  }}
                >
                  {group.label}
                </span>
                <div
                  style={{
                    flex: "1 1 0",
                    height: 1,
                    background: "rgba(255,255,255,0.08)",
                    marginLeft: Math.round(12 * s),
                    display: "flex",
                  }}
                />
              </div>
              {group.games.map((game, gi) =>
                gameCard(game, gi === 0 ? Math.round(cardGap * 0.5) : cardGap)
              )}
            </div>
          );
          firstBlock = false;
          return block;
        })}
      </div>
    );
  }

  const badge = (player: PlayerId) => (
    <div
      key={player}
      style={{
        display: "flex",
        alignItems: "center",
        background: c.chip,
        border: `1px solid ${c.cardBorder}`,
        borderRadius: 999,
        paddingLeft: Math.round(16 * s),
        paddingRight: Math.round(18 * s),
        paddingTop: Math.round(9 * s),
        paddingBottom: Math.round(9 * s),
        marginLeft: player === "rich" ? Math.round(12 * s) : 0,
      }}
    >
      {leader === player && (
        <div
          style={{
            width: Math.round(11 * s),
            height: Math.round(11 * s),
            borderRadius: 999,
            background: c.accent,
            marginRight: Math.round(9 * s),
            display: "flex",
          }}
        />
      )}
      <span
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: badgeName,
          letterSpacing: 1,
          color: c.textPrimary,
        }}
      >
        {PLAYER_NAMES[player].toUpperCase()}
      </span>
      <span
        style={{
          fontFamily: SANS,
          fontWeight: 500,
          fontSize: badgeRec,
          color: c.textSecondary,
          marginLeft: Math.round(11 * s),
        }}
      >
        {formatRecord(records[player])}
      </span>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: c.bgBottom,
          backgroundImage: `linear-gradient(180deg, ${c.bgTop} 0%, ${c.bgBottom} 100%)`,
          padding: pad,
          fontFamily: SANS,
        }}
      >
        {/* Header lower-third: title + season on the left, player badges on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            height: headerH,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: titleFont,
                letterSpacing: 1,
                lineHeight: 1,
                color: c.textPrimary,
              }}
            >
              WEEK {week} PICKS
            </span>
            <span
              style={{
                fontFamily: SANS,
                fontWeight: 500,
                fontSize: seasonFont,
                letterSpacing: 5,
                color: c.textSecondary,
                marginTop: Math.round(10 * s),
              }}
            >
              {season} NFL SEASON
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            {PLAYER_IDS.map((player) => badge(player))}
          </div>
        </div>

        {/* Accent rule under the title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: ruleH,
            marginTop: ruleGap,
          }}
        >
          <div
            style={{
              width: Math.round(96 * s),
              height: ruleH,
              background: c.accent,
              borderRadius: Math.round(ruleH / 2),
              display: "flex",
            }}
          />
          <div
            style={{
              flex: "1 1 0",
              height: 1,
              background: "rgba(255,255,255,0.08)",
              marginLeft: Math.round(14 * s),
              display: "flex",
            }}
          />
        </div>

        {/* Body */}
        <div style={{ display: "flex", marginTop: bodyGap }}>{body}</div>

        {/* Footer bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: footerH,
            marginTop: footerGap,
          }}
        >
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: Math.round(footerH * 0.5),
              letterSpacing: 2,
              color: c.textSecondary,
            }}
          >
            BRUCE &amp; RICH PICK&apos;EM
          </span>
          <span
            style={{
              fontFamily: SANS,
              fontWeight: 400,
              fontSize: Math.round(footerH * 0.42),
              letterSpacing: 2,
              color: c.textMuted,
            }}
          >
            WEEK {week} · {season} · GENERATED {genDate.toUpperCase()}
          </span>
        </div>
      </div>
    ),
    { width: W, height: H, fonts }
  );
}
