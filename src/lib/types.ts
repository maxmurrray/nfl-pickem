export type PlayerId = "dad" | "rich";

export const PLAYER_IDS: PlayerId[] = ["dad", "rich"];

export const PLAYER_NAMES: Record<PlayerId, string> = {
  dad: "Dad",
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

export function isGameLocked(game: Game, now: number = Date.now()): boolean {
  return new Date(game.kickoff).getTime() <= now;
}
