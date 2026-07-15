import type { Game, PlayerId, WeekPicks } from "./types";
import { PLAYER_IDS } from "./types";

export interface GameResult {
  finished: boolean;
  tie: boolean;
  winnerTeamId: string | null;
}

export function gameResult(game: Game): GameResult {
  if (!game.completed) return { finished: false, tie: false, winnerTeamId: null };
  const tie =
    game.home.score !== null &&
    game.away.score !== null &&
    game.home.score === game.away.score;
  const winner = game.home.winner ? game.home : game.away.winner ? game.away : null;
  return { finished: true, tie, winnerTeamId: winner?.teamId ?? null };
}

/** A tie in the actual game counts as correct for any pick. No pick = wrong. */
export function isPickCorrect(
  game: Game,
  pickedTeamId: string | null | undefined
): boolean {
  const result = gameResult(game);
  if (!result.finished || !pickedTeamId) return false;
  return result.tie || pickedTeamId === result.winnerTeamId;
}

export interface WinLoss {
  wins: number;
  losses: number;
}

export type PlayerRecords = Record<PlayerId, WinLoss>;

export function emptyRecords(): PlayerRecords {
  return { dad: { wins: 0, losses: 0 }, rich: { wins: 0, losses: 0 } };
}

/** Grade one week: only completed games count; a missing pick is a loss. */
export function gradeWeek(games: Game[], picks: WeekPicks): PlayerRecords {
  const records = emptyRecords();
  for (const game of games) {
    if (!game.completed) continue;
    for (const player of PLAYER_IDS) {
      if (isPickCorrect(game, picks[game.id]?.[player])) {
        records[player].wins++;
      } else {
        records[player].losses++;
      }
    }
  }
  return records;
}

export function addRecords(into: PlayerRecords, add: PlayerRecords): void {
  for (const player of PLAYER_IDS) {
    into[player].wins += add[player].wins;
    into[player].losses += add[player].losses;
  }
}

export function formatRecord(record: WinLoss): string {
  return `${record.wins}–${record.losses}`;
}
