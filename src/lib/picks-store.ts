import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlayerId } from "./types";

export interface StoredPick {
  player: PlayerId;
  season: number;
  week: number;
  gameId: string;
  teamId: string;
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

/** False means Supabase env vars are missing and picks live in server memory. */
export function isPersistent(): boolean {
  return supabase() !== null;
}

// Dev-only fallback so the app is usable before Supabase is configured.
// Picks stored here vanish on server restart — never rely on this in prod.
const memory: Map<string, StoredPick> = ((globalThis as any).__pickemMemory ??=
  new Map());

function memoryKey(p: Pick<StoredPick, "player" | "season" | "week" | "gameId">) {
  return `${p.player}:${p.season}:${p.week}:${p.gameId}`;
}

function fromRow(row: any): StoredPick {
  return {
    player: row.player,
    season: row.season,
    week: row.week,
    gameId: row.game_id,
    teamId: row.picked_team_id,
  };
}

export async function getPicksForWeek(
  season: number,
  week: number
): Promise<StoredPick[]> {
  const db = supabase();
  if (!db) {
    return [...memory.values()].filter(
      (p) => p.season === season && p.week === week
    );
  }
  const { data, error } = await db
    .from("picks")
    .select("player, season, week, game_id, picked_team_id")
    .eq("season", season)
    .eq("week", week);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function getPicksForSeason(season: number): Promise<StoredPick[]> {
  const db = supabase();
  if (!db) {
    return [...memory.values()].filter((p) => p.season === season);
  }
  const { data, error } = await db
    .from("picks")
    .select("player, season, week, game_id, picked_team_id")
    .eq("season", season);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function upsertPick(pick: StoredPick): Promise<void> {
  const db = supabase();
  if (!db) {
    memory.set(memoryKey(pick), pick);
    return;
  }
  const { error } = await db.from("picks").upsert(
    {
      player: pick.player,
      season: pick.season,
      week: pick.week,
      game_id: pick.gameId,
      picked_team_id: pick.teamId,
    },
    { onConflict: "player,season,week,game_id" }
  );
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}
