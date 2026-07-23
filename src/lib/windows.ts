import type { Game } from "./types";

const EASTERN = "America/New_York";

export interface GameWindow {
  /** Section label, e.g. "Sunday Early". */
  label: string;
  /** Kickoff time of the window's first game, e.g. "1:00 PM ET". */
  timeLabel: string;
  games: Game[];
}

function etParts(iso: string): { wd: string; hour: number } {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    weekday: "short",
  }).format(d); // "Thu", "Sun", "Mon", ...
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: EASTERN,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(d)
  );
  return { wd, hour };
}

/** Classify a kickoff into its broadcast window (US Eastern, where NFL slots live). */
function windowLabel(iso: string): string {
  const { wd, hour } = etParts(iso);
  switch (wd) {
    case "Thu":
      return "Thursday Night";
    case "Fri":
      return "Friday";
    case "Sat":
      return "Saturday";
    case "Mon":
      return "Monday Night";
    case "Sun":
      if (hour < 12) return "Sunday Morning"; // ~9:30 AM ET international games
      if (hour < 16) return "Sunday Early"; // ~1:00 PM ET
      if (hour < 18) return "Sunday Late"; // ~4:00–4:30 PM ET
      return "Sunday Night"; // ~8:20 PM ET
    default:
      // Rare midweek/oddball games — label by full weekday.
      return new Intl.DateTimeFormat("en-US", {
        timeZone: EASTERN,
        weekday: "long",
      }).format(new Date(iso));
  }
}

function timeLabel(iso: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
  return `${time} ET`;
}

/**
 * Group games into kickoff-window sections. Input is assumed already sorted by
 * kickoff (as getWeekGames returns), so sections come out chronologically and
 * each label's games are contiguous.
 */
export function groupByWindow(games: Game[]): GameWindow[] {
  const order: string[] = [];
  const byLabel = new Map<string, GameWindow>();
  for (const game of games) {
    const label = windowLabel(game.kickoff);
    let win = byLabel.get(label);
    if (!win) {
      win = { label, timeLabel: timeLabel(game.kickoff), games: [] };
      byLabel.set(label, win);
      order.push(label);
    }
    win.games.push(game);
  }
  return order.map((label) => byLabel.get(label)!);
}
