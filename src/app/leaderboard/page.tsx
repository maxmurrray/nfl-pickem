import { getSeasonContext, getWeekGames } from "@/lib/espn";
import {
  addRecords,
  emptyRecords,
  formatRecord,
  gradeWeek,
  type PlayerRecords,
} from "@/lib/grading";
import { getPicksForSeason } from "@/lib/picks-store";
import { PLAYER_NAMES, type WeekPicks } from "@/lib/types";
import Link from "next/link";

export const revalidate = 60;

export default async function LeaderboardPage() {
  const context = await getSeasonContext();
  const weeks = Array.from({ length: context.currentWeek }, (_, i) => i + 1);

  const [allWeeks, allPicks] = await Promise.all([
    Promise.all(weeks.map((w) => getWeekGames(context.season, w))),
    getPicksForSeason(context.season),
  ]);

  const picksByWeek = new Map<number, WeekPicks>();
  for (const pick of allPicks) {
    const weekPicks = picksByWeek.get(pick.week) ?? {};
    (weekPicks[pick.gameId] ??= {})[pick.player] = pick.teamId;
    picksByWeek.set(pick.week, weekPicks);
  }

  const totals = emptyRecords();
  const weekRows: { week: number; records: PlayerRecords; played: boolean }[] =
    [];
  for (const weekData of allWeeks) {
    const records = gradeWeek(weekData.games, picksByWeek.get(weekData.week) ?? {});
    const played = weekData.games.some((g) => g.completed);
    weekRows.push({ week: weekData.week, records, played });
    addRecords(totals, records);
  }

  const dadWins = totals.dad.wins;
  const richWins = totals.rich.wins;
  const anyPlayed = weekRows.some((r) => r.played);
  const leader =
    dadWins > richWins ? "dad" : richWins > dadWins ? "rich" : null;

  return (
    <main className="page">
      <div className="leader-callout">
        {!anyPlayed ? (
          <>
            <div className="leader-title">Season hasn&apos;t kicked off yet</div>
            <div className="leader-sub">
              {context.season} season · records will show up as games go final
            </div>
          </>
        ) : leader ? (
          <>
            <div className="leader-title">
              👑 {PLAYER_NAMES[leader]} leads by {Math.abs(dadWins - richWins)}
            </div>
            <div className="leader-sub">{context.season} season</div>
          </>
        ) : (
          <>
            <div className="leader-title">🤝 All tied up</div>
            <div className="leader-sub">{context.season} season</div>
          </>
        )}
        <div className="season-totals">
          <span className={leader === "dad" ? "leading" : ""}>
            {PLAYER_NAMES.dad} <strong>{formatRecord(totals.dad)}</strong>
          </span>
          <span className="dot">·</span>
          <span className={leader === "rich" ? "leading" : ""}>
            {PLAYER_NAMES.rich} <strong>{formatRecord(totals.rich)}</strong>
          </span>
        </div>
      </div>

      <table className="week-table">
        <thead>
          <tr>
            <th>Week</th>
            <th>{PLAYER_NAMES.dad}</th>
            <th>{PLAYER_NAMES.rich}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {weekRows.map(({ week, records, played }) => {
            const dad = records.dad.wins;
            const rich = records.rich.wins;
            const weekWinner = !played
              ? ""
              : dad > rich
                ? PLAYER_NAMES.dad
                : rich > dad
                  ? PLAYER_NAMES.rich
                  : "Tie";
            return (
              <tr key={week}>
                <td>
                  <Link href={`/week/${week}`} className="week-link">
                    Week {week}
                  </Link>
                </td>
                <td>{played ? formatRecord(records.dad) : "—"}</td>
                <td>{played ? formatRecord(records.rich) : "—"}</td>
                <td className="week-winner">{weekWinner}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
