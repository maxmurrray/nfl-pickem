import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { getSeasonLockTime } from "@/lib/espn";
import {
  DIVISIONS,
  DIVISION_TEAMS,
  getTeamMeta,
  type Conference,
  type Division,
} from "@/lib/divisions";
import { getPredictionsForSeason, toDbPlayer } from "@/lib/predictions-store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPlayerId } from "@/lib/types";

export const dynamic = "force-dynamic";

/* ===========================================================================
   DIVISION PREDICTIONS GRAPHIC — plain black-on-white print aesthetic.
   Deliberately unlike the broadcast weekly-picks graphic: no dark cards, no
   gradients, shadows, or rounded corners.
   =========================================================================== */
const COLORS = {
  afc: "#CE1126",
  nfc: "#143D66",
  // Subtle vertical gradients on the division header bars.
  afcBar: "linear-gradient(180deg, #D8283C 0%, #CE1126 50%, #B30E21 100%)",
  nfcBar: "linear-gradient(180deg, #1B4A78 0%, #143D66 50%, #0F2F50 100%)",
  columnHeader: "#B3B3B3",
  cardGrad: "linear-gradient(180deg, #FFFFFF 0%, #F4F4F4 100%)",
  cardTop: "#FFFFFF",
  bg: "#F3F3F3", // off-white canvas base
  panel: "#FFFFFF", // faint diagonal light-sweep panels
  divider: "#C8C8C8", // dotted row dividers
  barBottomLine: "rgba(0,0,0,0.28)",
  black: "#000000",
  white: "#FFFFFF",
};

// Base canvas 770×1400 (tall portrait). Supersampled to ~2233×4060 — just under
// Twitter's 4096px cap — so the text stays crisp after Twitter downscales and
// recompresses the upload.
const BASE_W = 770;
const BASE_H = 1400;
const S = 2.9;
const u = (n: number) => Math.round(n * S);

// Single heavy condensed family (Barlow Condensed ExtraBold) — the broadcast
// look wants tighter/bolder than the plain Bold. Registered under weight 700 so
// every existing 700 style picks it up.
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/barlowcondensed/BarlowCondensed-ExtraBold.ttf";
const FONT = "Barlow Condensed";

type FontDef = { name: string; data: ArrayBuffer; weight: 700; style: "normal" };
let fontCache: FontDef[] | null | undefined;

async function loadFonts(): Promise<FontDef[] | undefined> {
  if (fontCache !== undefined) return fontCache ?? undefined;
  try {
    const res = await fetch(FONT_URL, { next: { revalidate: 604800 } });
    if (!res.ok) throw new Error(`font ${res.status}`);
    fontCache = [{ name: FONT, data: await res.arrayBuffer(), weight: 700, style: "normal" }];
  } catch {
    fontCache = null;
  }
  return fontCache ?? undefined;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Read a PNG that ships in /public. Going over HTTP put these behind
 * fetchPng's 24h revalidate cache, so swapping an asset didn't take effect
 * until the cache aged out. Reading from disk is both faster and current.
 */
async function localPng(relPath: string): Promise<string> {
  try {
    const buf = await readFile(join(process.cwd(), "public", relPath));
    if (buf.length < 100 || !buf.subarray(0, 4).equals(PNG_MAGIC)) return "";
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

async function fetchPng(url: string): Promise<string> {
  for (const init of [{ next: { revalidate: 86400 } }, { cache: "no-store" }] as RequestInit[]) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || !buf.subarray(0, 4).equals(PNG_MAGIC)) continue;
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      /* retry uncached */
    }
  }
  return "";
}

interface Row {
  abbr: string;
  logo: string; // data URI (may be "")
  rec: string; // "12-5" or "—"
}
interface Card {
  division: Division;
  rows: Row[];
}

function isConference(v: unknown): v is Conference {
  return v === "AFC" || v === "NFC";
}

/**
 * GET /api/division-graphic?season=2026&conference=AFC
 *
 * Portrait PNG (1540×2800) of Bruce's and Rich's predictions for one
 * conference. Requires the season to be locked (it reveals both players).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = Number(params.get("season"));
  const conference = params.get("conference");

  if (!Number.isInteger(season)) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  if (!isConference(conference)) {
    return NextResponse.json({ error: "Invalid conference" }, { status: 400 });
  }

  const [lockTime, all, meta, fonts] = await Promise.all([
    getSeasonLockTime(season),
    getPredictionsForSeason(season),
    getTeamMeta(),
    loadFonts(),
  ]);

  const locked = lockTime !== null && lockTime <= Date.now();

  // After lock: both players (two columns). Before lock: only the requesting
  // player's own predictions (one centered column), so the opponent stays
  // hidden. A pre-lock request must name a player.
  const playerParam = params.get("player");
  let renderPlayers: ("bruce" | "rich")[];
  if (locked) {
    renderPlayers = ["bruce", "rich"];
  } else if (isPlayerId(playerParam)) {
    renderPlayers = [toDbPlayer(playerParam)];
  } else {
    return NextResponse.json(
      { error: "Before kickoff, pass ?player to export your own predictions." },
      { status: 409 }
    );
  }

  // Build both players' columns; placeholders where a player didn't submit.
  const buildColumn = (dbPlayer: "bruce" | "rich"): Card[] =>
    DIVISIONS.map((division) => {
      const preds = all
        .filter(
          (p) =>
            p.player === dbPlayer &&
            p.conference === conference &&
            p.division === division
        )
        .sort((a, b) => a.rank - b.rank);

      // Draw whatever exists. Requiring all four rows meant one unfilled team
      // blanked the entire division, which is why a mostly-complete conference
      // still exported as nothing but dashes.
      const saved = new Map(preds.map((p) => [p.teamAbbr, p]));
      const ordered = preds.map((p) => p.teamAbbr);
      const rest = DIVISION_TEAMS[conference][division].filter((a) => !saved.has(a));
      const rows: Row[] = [...ordered, ...rest].map((abbr) => {
        const p = saved.get(abbr);
        return {
          abbr,
          logo: "",
          rec: p ? `${p.wins}-${p.losses}` : "—",
        };
      });
      return { division, rows };
    });

  const columns = { bruce: buildColumn("bruce"), rich: buildColumn("rich") };

  // Fetch every team logo once (same 16 teams regardless of column).
  const abbrs = new Set<string>();
  for (const col of [columns.bruce, columns.rich]) {
    for (const card of col) for (const r of card.rows) abbrs.add(r.abbr);
  }
  const logoEntries = await Promise.all(
    [...abbrs].map(async (abbr): Promise<[string, string]> => {
      const url = meta.get(abbr)?.logo;
      return [abbr, url ? await fetchPng(url) : ""];
    })
  );
  const logoByAbbr = new Map(logoEntries);
  for (const col of [columns.bruce, columns.rich]) {
    for (const card of col) {
      for (const r of card.rows) r.logo = logoByAbbr.get(r.abbr) ?? "";
    }
  }

  // Conference mark (full-color) — used both in the header and, on a white chip,
  // inside each division bar.
  const base = conference.toLowerCase();
  const confLogo = await localPng(`logos/${base}.png`);
  // Knockout mark for the coloured division bar. The full-colour AFC shield is
  // red and disappears on a red bar, which is why a white chip used to sit
  // behind it; the white asset removes the need for the chip entirely.
  const confLogoWhite = await localPng(`logos/${base}-white.png`);

  const accent = conference === "AFC" ? COLORS.afc : COLORS.nfc;
  const barGrad = conference === "AFC" ? COLORS.afcBar : COLORS.nfcBar;
  const title = `${conference} REGULAR SEASON PREDICTIONS`;

  // ---- metrics (base units → u()) ----
  const margin = 35;
  const contentW = BASE_W - margin * 2; // 700
  const gutter = 20;
  const colW = (contentW - gutter) / 2; // 340

  const headerBarH = 30;
  const colHeaderH = 26;
  const rowH = 53;
  const cardGap = 20;

  // Row column widths (within a card).
  const rankCellW = colW * 0.22; // rank sits ~8% in, logo starts ~22%
  const recCellW = colW * 0.3;
  const rankPadLeft = colW * 0.08;
  const teamLogoSize = 45;

  const cell = (w: number): React.CSSProperties => ({
    width: u(w),
    display: "flex",
    flexShrink: 0,
  });

  const headerLabelStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: u(13),
    letterSpacing: u(0.5),
    color: COLORS.black,
    textTransform: "uppercase",
  };

  const teamLogo = (uri: string) =>
    uri ? (
      <img src={uri} width={u(teamLogoSize)} height={u(teamLogoSize)} />
    ) : (
      <div style={{ width: u(teamLogoSize), height: u(teamLogoSize), display: "flex" }} />
    );

  const cardNode = (card: Card) => (
    <div
      key={card.division}
      style={{
        display: "flex",
        flexDirection: "column",
        width: u(colW),
        border: `${u(2)}px solid ${COLORS.black}`,
        backgroundColor: COLORS.cardTop,
        backgroundImage: COLORS.cardGrad,
        // Cards sit on the background.
        boxShadow: `${u(4)}px ${u(5)}px ${u(8)}px rgba(0,0,0,0.38)`,
      }}
    >
      {/* Division header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: u(headerBarH),
          backgroundColor: accent,
          backgroundImage: barGrad,
          borderBottom: `${u(1)}px solid ${COLORS.barBottomLine}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", width: u(40), paddingLeft: u(8) }}>
          {confLogoWhite ? <img src={confLogoWhite} height={u(18)} /> : null}
        </div>
        <div
          style={{
            flex: "1 1 0",
            display: "flex",
            justifyContent: "center",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: u(16),
            letterSpacing: u(1),
            color: COLORS.white,
            textTransform: "uppercase",
          }}
        >
          {card.division}
        </div>
        <div style={{ display: "flex", width: u(40) }} />
      </div>

      {/* Column header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: u(colHeaderH),
          background: COLORS.columnHeader,
        }}
      >
        <div style={{ ...cell(rankCellW), paddingLeft: u(rankPadLeft) }}>
          <span style={headerLabelStyle}>#</span>
        </div>
        <div style={{ display: "flex", flex: "1 1 0", justifyContent: "center" }}>
          <span style={headerLabelStyle}>TEAM</span>
        </div>
        <div style={{ ...cell(recCellW), justifyContent: "center" }}>
          <span style={headerLabelStyle}>REC</span>
        </div>
      </div>

      {/* Team rows — dotted dividers BETWEEN rows only (not top/bottom). */}
      {card.rows.map((r, i) => (
        <div key={r.abbr} style={{ display: "flex", flexDirection: "column" }}>
          {i > 0 && (
            // Drawn round dots — Satori has no dotted border. Negative margins
            // keep the divider net-zero height so row/card heights are unchanged.
            <div
              style={{
                display: "flex",
                height: u(2),
                marginTop: u(-1),
                marginBottom: u(-1),
                marginLeft: u(10),
                marginRight: u(10),
                alignItems: "center",
                justifyContent: "space-between",
                overflow: "hidden",
              }}
            >
              {Array.from({ length: 34 }).map((_, k) => (
                <div
                  key={k}
                  style={{
                    width: u(2),
                    height: u(2),
                    borderRadius: u(2),
                    background: COLORS.divider,
                    display: "flex",
                  }}
                />
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", height: u(rowH) }}>
            <div style={{ ...cell(rankCellW), paddingLeft: u(rankPadLeft), alignItems: "center" }}>
              <span
                style={{
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: u(22),
                  letterSpacing: u(0.5),
                  color: COLORS.black,
                }}
              >
                {i + 1}
              </span>
            </div>
            <div style={{ display: "flex", flex: "1 1 0", alignItems: "center", minWidth: 0 }}>
              {teamLogo(r.logo)}
              <span
                style={{
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: u(20),
                  letterSpacing: u(0.5),
                  color: COLORS.black,
                  marginLeft: u(10),
                  textTransform: "uppercase",
                }}
              >
                {r.abbr}
              </span>
            </div>
            <div style={{ ...cell(recCellW), justifyContent: "center", alignItems: "center" }}>
              <span
                style={{
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: u(22),
                  letterSpacing: u(0.5),
                  color: COLORS.black,
                }}
              >
                {r.rec}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const column = (dbPlayer: "bruce" | "rich", label: string, marginLeft = 0) => (
    <div style={{ display: "flex", flexDirection: "column", width: u(colW), marginLeft: u(marginLeft) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: u(12),
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: u(40),
          letterSpacing: u(0.5),
          lineHeight: 1,
          color: COLORS.black,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      {columns[dbPlayer].map((card, i) => (
        <div key={card.division} style={{ display: "flex", marginTop: i === 0 ? 0 : u(cardGap) }}>
          {cardNode(card)}
        </div>
      ))}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          background: COLORS.bg,
          overflow: "hidden",
          fontFamily: FONT,
        }}
      >
        {/* Faint diagonal light-sweep panels over the off-white base */}
        {[
          { left: -170, width: 300, opacity: 0.55 },
          { left: 150, width: 190, opacity: 0.4 },
          { left: 430, width: 250, opacity: 0.5 },
        ].map((p, i) => (
          <div
            key={`panel-${i}`}
            style={{
              position: "absolute",
              top: u(-260),
              left: u(p.left),
              width: u(p.width),
              height: u(BASE_H + 520),
              background: COLORS.panel,
              opacity: p.opacity,
              transform: "rotate(24deg)",
              display: "flex",
            }}
          />
        ))}

        {/* Content */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: u(margin),
          }}
        >
          {/* Conference logo */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: u(5) }}>
            {confLogo ? (
              <img src={confLogo} height={u(70)} />
            ) : (
              <div style={{ display: "flex", height: u(70) }} />
            )}
          </div>

          {/* Title with flanking conference-color rules */}
          <div style={{ display: "flex", alignItems: "center", width: u(contentW), marginTop: u(12) }}>
            <div style={{ flex: "1 1 0", height: u(2), background: accent, display: "flex" }} />
            <div
              style={{
                display: "flex",
                marginLeft: u(12),
                marginRight: u(12),
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: u(20),
                letterSpacing: u(2),
                color: COLORS.black,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </div>
            <div style={{ flex: "1 1 0", height: u(2), background: accent, display: "flex" }} />
          </div>

        {/* Player column(s): both after lock, own centered column before. */}
        <div
          style={{
            display: "flex",
            width: u(contentW),
            marginTop: u(22),
            justifyContent: "center",
          }}
        >
          {renderPlayers.map((p, i) => (
            <div key={p} style={{ display: "flex" }}>
              {column(p, p === "bruce" ? "Bruce" : "Rich", i === 0 ? 0 : gutter)}
            </div>
          ))}
          </div>
        </div>
      </div>
    ),
    { width: u(BASE_W), height: u(BASE_H), fonts }
  );
}
