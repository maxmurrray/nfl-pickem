import { NextRequest, NextResponse } from "next/server";
import { getWeekGames } from "@/lib/espn";
import {
  getPicksForWeek,
  isPersistent,
  upsertPick,
} from "@/lib/picks-store";
import { isGameLocked, isPlayerId, type WeekPicks } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/picks?season=2026&week=1&player=dad
 *
 * Returns picks for the week, keyed by gameId. The opponent's pick for a
 * game is only included once that game has kicked off (locked), so nobody
 * can peek and copy before lock.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const season = Number(params.get("season"));
  const week = Number(params.get("week"));
  const viewer = params.get("player");

  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    return NextResponse.json({ error: "Invalid season/week" }, { status: 400 });
  }
  if (!isPlayerId(viewer)) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }

  const [{ games }, rows] = await Promise.all([
    getWeekGames(season, week),
    getPicksForWeek(season, week),
  ]);

  const now = Date.now();
  const lockedGameIds = new Set(
    games.filter((g) => isGameLocked(g, now)).map((g) => g.id)
  );

  const gameIds = new Set(games.map((g) => g.id));
  // Pick counts reveal completeness (for the graphic button) without
  // revealing which teams the opponent picked.
  const counts = { dad: 0, rich: 0 };
  const picks: WeekPicks = {};
  for (const row of rows) {
    if (!gameIds.has(row.gameId)) continue;
    counts[row.player]++;
    // Hide the opponent's pick until the game locks.
    if (row.player !== viewer && !lockedGameIds.has(row.gameId)) continue;
    (picks[row.gameId] ??= {})[row.player] = row.teamId;
  }

  return NextResponse.json({
    picks,
    counts,
    total: games.length,
    persistent: isPersistent(),
  });
}

/**
 * POST /api/picks
 * Body: { player, season, week, gameId, teamId }
 *
 * Lock enforcement lives here: any game whose kickoff has passed rejects
 * writes with 409, regardless of what the UI shows.
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { player, season, week, gameId, teamId } = body ?? {};
  if (!isPlayerId(player)) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }
  if (
    !Number.isInteger(season) ||
    !Number.isInteger(week) ||
    week < 1 ||
    typeof gameId !== "string" ||
    typeof teamId !== "string"
  ) {
    return NextResponse.json({ error: "Invalid pick payload" }, { status: 400 });
  }

  const { games } = await getWeekGames(season, week);
  const game = games.find((g) => g.id === gameId);
  if (!game) {
    return NextResponse.json({ error: "Unknown game" }, { status: 404 });
  }
  if (isGameLocked(game)) {
    return NextResponse.json(
      { error: "This game has kicked off — picks are locked." },
      { status: 409 }
    );
  }
  if (teamId !== game.home.teamId && teamId !== game.away.teamId) {
    return NextResponse.json(
      { error: "Team is not playing in this game" },
      { status: 400 }
    );
  }

  await upsertPick({ player, season, week, gameId, teamId });
  return NextResponse.json({ ok: true, persistent: isPersistent() });
}
