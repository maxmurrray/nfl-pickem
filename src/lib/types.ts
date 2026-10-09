export type PlayerId = "dad" | "rich";

export const PLAYER_IDS: PlayerId[] = ["dad", "rich"];

// "dad" stays as the stored player id; only the display name is Bruce.
export const PLAYER_NAMES: Record<PlayerId, string> = {
  dad: "Bruce",
  rich: "Rich",
};

export function otherPlayer(player: PlayerId): PlayerId {
  return player === "dad" ? "rich" : "dad";
}

export function isPlayerId(value: unknown): value is PlayerId {
  return value === "dad" || value === "rich";
}

export interface GameSide {
  teamId: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  logo: string | null;
  color: string | null;
  score: number | null;
  winner: boolean;
}

export type GameState = "pre" | "in" | "post";

export interface Game {
  id: string;
  kickoff: string; // ISO UTC from ESPN
  shortName: string;
  state: GameState;
  completed: boolean;
  statusDetail: string; // e.g. "9/9 - 8:20 PM EDT", "Final", "End of 3rd"
  broadcast: string | null;
  home: GameSide;
  away: GameSide;
}

export interface WeekData {
  season: number;
  week: number;
  games: Game[];
}

/** Picks for a week keyed by gameId, then player. */
export type WeekPicks = Record<string, Partial<Record<PlayerId, string>>>;

/** Whether the game's kickoff has passed. Drives when the opponent's pick is
 *  revealed — that stays tied to kickoff for every game, exempt or not. */
export function hasKickedOff(game: Game, now: number = Date.now()): boolean {
  return new Date(game.kickoff).getTime() <= now;
}

/** Weekdays (US Eastern) whose games never lock. Thursday night is the one
 *  game regularly picked late — the show records Friday, so both players
 *  need to be able to enter (or change) it after it has already been played.
 *  The pick still grades normally and still shows on the graphic. */
export const LOCK_EXEMPT_DAYS: string[] = ["Thu"];

export function isLockExempt(game: Game): boolean {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(new Date(game.kickoff));
  return LOCK_EXEMPT_DAYS.includes(day);
}

/** Whether picks for the game are closed to edits. */
export function isGameLocked(game: Game, now: number = Date.now()): boolean {
  if (isLockExempt(game)) return false;
  return hasKickedOff(game, now);
}
