import type { Game, GameSide, WeekData } from "./types";

const SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

// Regular season only for now. To add playoffs later, thread a seasonType
// through getWeekGames/the picks API and store it alongside season+week.
export const REGULAR_SEASON = 2;

export interface SeasonContext {
  season: number;
  currentWeek: number;
  maxWeek: number;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`ESPN request failed (${res.status}): ${url}`);
  return res.json();
}

/**
 * Current season/week straight from ESPN's default scoreboard response.
 * Outside the regular season we clamp: preseason points at week 1,
 * postseason points at the final regular-season week.
 */
export async function getSeasonContext(): Promise<SeasonContext> {
  const data = await fetchJson(SCOREBOARD_URL);
  const season: number = data?.season?.year ?? new Date().getFullYear();
  const seasonType: number = data?.season?.type ?? REGULAR_SEASON;

  const calendar: any[] = data?.leagues?.[0]?.calendar ?? [];
  const regularSeason = calendar.find(
    (c) => Number(c?.value) === REGULAR_SEASON
  );
  const maxWeek: number = regularSeason?.entries?.length || 18;

  let currentWeek: number = data?.week?.number ?? 1;
  if (seasonType < REGULAR_SEASON) currentWeek = 1;
  if (seasonType > REGULAR_SEASON) currentWeek = maxWeek;
  currentWeek = Math.min(Math.max(currentWeek, 1), maxWeek);

  return { season, currentWeek, maxWeek };
}

/** All games for one regular-season week, sorted by kickoff. */
export async function getWeekGames(
  season: number,
  week: number
): Promise<WeekData> {
  const data = await fetchJson(
    `${SCOREBOARD_URL}?seasontype=${REGULAR_SEASON}&week=${week}&dates=${season}`
  );
  const games: Game[] = (data?.events ?? []).map(parseEvent);
  games.sort(
    (a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id)
  );
  return { season, week, games };
}

/**
 * Kickoff (epoch ms) of the FIRST regular-season game of the season — the
 * moment division predictions lock. null if week 1 isn't scheduled yet.
 */
export async function getSeasonLockTime(season: number): Promise<number | null> {
  const { games } = await getWeekGames(season, 1);
  if (games.length === 0) return null;
  return Math.min(...games.map((g) => new Date(g.kickoff).getTime()));
}

/** Whether the season's predictions are locked (first kickoff has passed). */
export async function isSeasonLocked(
  season: number,
  now: number = Date.now()
): Promise<boolean> {
  const lock = await getSeasonLockTime(season);
  return lock !== null && lock <= now;
}

function parseEvent(event: any): Game {
  const competition = event?.competitions?.[0] ?? {};
  const competitors: any[] = competition?.competitors ?? [];
  const home = competitors.find((c) => c?.homeAway === "home");
  const away = competitors.find((c) => c?.homeAway === "away");
  const status = event?.status?.type ?? {};
  const state =
    status.state === "in" || status.state === "post" ? status.state : "pre";

  return {
    id: String(event.id),
    kickoff: event.date,
    shortName: event.shortName ?? "",
    state,
    completed: Boolean(status.completed),
    statusDetail: status.shortDetail ?? status.detail ?? "",
    broadcast: competition?.broadcasts?.[0]?.names?.[0] ?? null,
    home: parseSide(home),
    away: parseSide(away),
  };
}

function parseSide(competitor: any): GameSide {
  const team = competitor?.team ?? {};
  const rawScore = competitor?.score;
  return {
    teamId: String(team.id ?? competitor?.id ?? ""),
    abbreviation: team.abbreviation ?? "",
    displayName: team.displayName ?? "",
    shortDisplayName: team.shortDisplayName ?? team.abbreviation ?? "",
    logo: team.logo ?? null,
    color: team.color ?? null,
    score:
      rawScore === undefined || rawScore === null || rawScore === ""
        ? null
        : Number(rawScore),
    winner: competitor?.winner === true,
  };
}
