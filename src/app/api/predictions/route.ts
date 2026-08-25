import { NextRequest, NextResponse } from "next/server";
import { getSeasonLockTime } from "@/lib/espn";
import {
  DIVISIONS,
  DIVISION_TEAMS,
  type Conference,
  type Division,
} from "@/lib/divisions";
import {
  getPredictionsForSeason,
  isPersistent,
  toDbPlayer,
  upsertPredictions,
  type DivisionPrediction,
} from "@/lib/predictions-store";
import { isPlayerId } from "@/lib/types";

export const dynamic = "force-dynamic";

function isConference(v: unknown): v is Conference {
  return v === "AFC" || v === "NFC";
}
function isDivision(v: unknown): v is Division {
  return DIVISIONS.includes(v as Division);
}

/**
 * GET /api/predictions?season=2026&player=dad
 *
 * The viewer's own predictions always; the opponent's only after the season
 * locks (first kickoff), so nobody can copy beforehand.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = Number(params.get("season"));
  const viewer = params.get("player");

  if (!Number.isInteger(season)) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  if (!isPlayerId(viewer)) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }

  const [lockTime, all] = await Promise.all([
    getSeasonLockTime(season),
    getPredictionsForSeason(season),
  ]);
  const locked = lockTime !== null && lockTime <= Date.now();
  const viewerDb = toDbPlayer(viewer);

  // Before lock, strip the opponent's rows entirely.
  const predictions = locked ? all : all.filter((p) => p.player === viewerDb);

  return NextResponse.json({
    locked,
    lockTime,
    predictions: predictions.map((p) => ({
      player: p.player,
      conference: p.conference,
      division: p.division,
      teamAbbr: p.teamAbbr,
      rank: p.rank,
      wins: p.wins,
      losses: p.losses,
      updatedAt: p.updatedAt ?? null,
    })),
    persistent: isPersistent(),
  });
}

interface IncomingTeam {
  division: Division;
  teamAbbr: string;
  rank: number;
  wins: number;
  losses: number;
}

/**
 * POST /api/predictions
 * Body: { player, season, conference, predictions: IncomingTeam[16] }
 *
 * Saves one whole conference. Rejected with 409 once the season has locked.
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { player, season, conference } = body ?? {};
  const incoming: unknown = body?.predictions;

  if (!isPlayerId(player)) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }
  if (!Number.isInteger(season)) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  if (!isConference(conference)) {
    return NextResponse.json({ error: "Invalid conference" }, { status: 400 });
  }
  if (!Array.isArray(incoming)) {
    return NextResponse.json({ error: "Invalid predictions" }, { status: 400 });
  }

  // Lock enforcement (server-side, regardless of what the UI shows).
  const lockTime = await getSeasonLockTime(season);
  if (lockTime !== null && lockTime <= Date.now()) {
    return NextResponse.json(
      { error: "Predictions are locked — the season has started." },
      { status: 409 }
    );
  }

  // Validate: every division of the conference, all four teams, ranks a
  // permutation of 1–4, records 0–17 summing to 17.
  const byDivision = new Map<Division, IncomingTeam[]>();
  for (const raw of incoming as IncomingTeam[]) {
    if (
      !isDivision(raw?.division) ||
      typeof raw?.teamAbbr !== "string" ||
      !Number.isInteger(raw?.rank) ||
      !Number.isInteger(raw?.wins) ||
      !Number.isInteger(raw?.losses)
    ) {
      return NextResponse.json({ error: "Malformed prediction row" }, { status: 400 });
    }
    if (raw.wins < 0 || raw.wins > 17 || raw.losses < 0 || raw.losses > 17) {
      return NextResponse.json({ error: "Record out of range (0–17)" }, { status: 400 });
    }
    if (raw.wins + raw.losses !== 17) {
      return NextResponse.json(
        { error: `${raw.teamAbbr}: wins + losses must equal 17` },
        { status: 400 }
      );
    }
    const list = byDivision.get(raw.division) ?? [];
    list.push(raw);
    byDivision.set(raw.division, list);
  }

  // Partial saves are allowed, the same way a single weekly pick saves on its
  // own. Requiring all sixteen teams meant one blank field threw away every
  // other row the user had filled in, and the graphic then had nothing to draw.
  // Each row still has to be internally valid (checked above); the conference
  // simply does not have to be complete.
  for (const division of DIVISIONS) {
    const rows = byDivision.get(division) ?? [];
    const expected = new Set(DIVISION_TEAMS[conference][division]);
    for (const r of rows) {
      if (!expected.has(r.teamAbbr)) {
        return NextResponse.json(
          { error: `${r.teamAbbr} is not in ${conference} ${division}.` },
          { status: 400 }
        );
      }
    }
    const abbrs = new Set(rows.map((r) => r.teamAbbr));
    if (abbrs.size !== rows.length) {
      return NextResponse.json(
        { error: `Duplicate team in ${conference} ${division}.` },
        { status: 400 }
      );
    }
  }

  const dbPlayer = toDbPlayer(player);
  const toSave: DivisionPrediction[] = (incoming as IncomingTeam[]).map((r) => ({
    season,
    player: dbPlayer,
    conference,
    division: r.division,
    teamAbbr: r.teamAbbr,
    rank: r.rank,
    wins: r.wins,
    losses: r.losses,
  }));

  await upsertPredictions(toSave);
  return NextResponse.json({ ok: true, persistent: isPersistent() });
}
