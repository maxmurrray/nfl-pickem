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

// A second client, for deletes only.
//
// The app runs on the anon key, which has select/insert/update but no delete
// (supabase/schema.sql). That is deliberate — it means nobody can wipe a
// season by pointing a script at the public key. Clearing a player therefore
// needs the service_role key, which lives only in the server environment and
// is never sent to the browser.
let serviceCache: SupabaseClient | null | undefined;

function supabaseService(): SupabaseClient | null {
  if (serviceCache === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    serviceCache =
      url && key
        ? createClient(url, key, { auth: { persistSession: false } })
        : null;
  }
  return serviceCache;
}

/** Thrown when the server has no key that is allowed to delete. */
export class ResetUnavailableError extends Error {
  constructor() {
    super(
      "Reset isn't configured on this server: SUPABASE_SERVICE_ROLE_KEY is missing."
    );
    this.name = "ResetUnavailableError";
  }
}

// Dev fallback when Supabase isn't configured. This used to be memory-only,
// which meant a whole conference of predictions vanished on every server
// restart — and silently, because the save still reported success. It now
// mirrors to a JSON file so local work survives restarts.
//
// This is NOT a substitute for Supabase: serverless instances don't share a
// filesystem, so a deployment still needs SUPABASE_URL / SUPABASE_ANON_KEY.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DEV_STORE = join(process.cwd(), ".data", "division-predictions.json");

function loadFromDisk(): Map<string, DivisionPrediction> {
  try {
    const raw = readFileSync(DEV_STORE, "utf8");
    const rows: DivisionPrediction[] = JSON.parse(raw);
    return new Map(rows.map((r) => [memoryKey(r), r]));
  } catch {
    return new Map();
  }
}

function saveToDisk(map: Map<string, DivisionPrediction>): void {
  try {
    mkdirSync(dirname(DEV_STORE), { recursive: true });
    writeFileSync(DEV_STORE, JSON.stringify([...map.values()], null, 2));
  } catch {
    /* best effort — a read-only fs just means we're back to memory-only */
  }
}

const memory: Map<string, DivisionPrediction> = ((globalThis as any)
  .__predictionMemory ??= loadFromDisk());

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
    saveToDisk(memory);
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

/**
 * Remove every division prediction one player has saved for a season, so their
 * board comes back blank.
 *
 * Returns the number of rows removed. Verifies afterwards rather than trusting
 * the status: a delete that RLS refuses still comes back as a cheerful success
 * with nothing deleted, which would report a clean slate that never happened.
 */
export async function deletePredictions(
  season: number,
  player: DbPlayer
): Promise<number> {
  const db = supabase();

  // Dev fallback (no Supabase configured) — clear the JSON-backed store.
  if (!db) {
    let removed = 0;
    for (const [key, row] of memory) {
      if (row.season === season && row.player === player) {
        memory.delete(key);
        removed++;
      }
    }
    saveToDisk(memory);
    return removed;
  }

  const service = supabaseService();
  if (!service) throw new ResetUnavailableError();

  const { data, error } = await service
    .from("division_predictions")
    .delete()
    .eq("season", season)
    .eq("player", player)
    .select("id");
  if (error) throw new Error(`Supabase delete failed: ${error.message}`);

  const { data: left, error: checkError } = await service
    .from("division_predictions")
    .select("id")
    .eq("season", season)
    .eq("player", player);
  if (checkError) throw new Error(`Supabase re-check failed: ${checkError.message}`);
  if ((left ?? []).length > 0) {
    throw new Error(
      `Reset didn't take: ${left!.length} rows still there. Is SUPABASE_SERVICE_ROLE_KEY the service_role key?`
    );
  }

  return (data ?? []).length;
}
