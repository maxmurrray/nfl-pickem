import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlayerId } from "./types";
import type { Conference, Division } from "./divisions";

// The new table stores the player as 'bruce'/'rich'; the app's internal id for
// Bruce is 'dad'. Map at this boundary only.
export type DbPlayer = "bruce" | "rich";

export function toDbPlayer(player: PlayerId): DbPlayer {
  return player === "dad" ? "bruce" : "rich";
}
export function fromDbPlayer(player: DbPlayer): PlayerId {
  return player === "bruce" ? "dad" : "rich";
}

export interface DivisionPrediction {
  season: number;
  player: DbPlayer;
  conference: Conference;
  division: Division;
  teamAbbr: string;
  rank: number;
  wins: number;
  losses: number;
  updatedAt?: string;
}

let client: SupabaseClient | null | undefined;

function supabase(): SupabaseClient | null {
  if (client === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    client =
      url && key
        ? createClient(url, key, { auth: { persistSession: false } })
        : null;
  }
  return client;
}

export function isPersistent(): boolean {
  return supabase() !== null;
}

// Dev-only in-memory fallback (mirrors picks-store) — vanishes on restart.
const memory: Map<string, DivisionPrediction> = ((globalThis as any)
  .__predictionMemory ??= new Map());

function memoryKey(
  p: Pick<
    DivisionPrediction,
    "season" | "player" | "conference" | "division" | "teamAbbr"
  >
) {
  return `${p.season}:${p.player}:${p.conference}:${p.division}:${p.teamAbbr}`;
}

function fromRow(row: any): DivisionPrediction {
  return {
    season: row.season,
    player: row.player,
    conference: row.conference,
    division: row.division,
    teamAbbr: row.team_abbr,
    rank: row.rank,
    wins: row.wins,
    losses: row.losses,
    updatedAt: row.updated_at ?? undefined,
  };
}

export async function getPredictionsForSeason(
  season: number
): Promise<DivisionPrediction[]> {
  const db = supabase();
  if (!db) {
    return [...memory.values()].filter((p) => p.season === season);
  }
  const { data, error } = await db
    .from("division_predictions")
    .select(
      "season, player, conference, division, team_abbr, rank, wins, losses, updated_at"
    )
    .eq("season", season);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

/** Bulk upsert (one conference's worth of rows at a time). */
export async function upsertPredictions(
  rows: DivisionPrediction[]
): Promise<void> {
  if (rows.length === 0) return;
  const db = supabase();
  if (!db) {
    for (const row of rows) memory.set(memoryKey(row), row);
    return;
  }
  const { error } = await db.from("division_predictions").upsert(
    rows.map((r) => ({
      season: r.season,
      player: r.player,
      conference: r.conference,
      division: r.division,
      team_abbr: r.teamAbbr,
      rank: r.rank,
      wins: r.wins,
      losses: r.losses,
    })),
    { onConflict: "season,player,conference,division,team_abbr" }
  );
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}
