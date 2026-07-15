import { getSeasonContext, getWeekGames } from "@/lib/espn";
import WeekSelector from "./WeekSelector";
import WeekView from "./WeekView";

/** Shared server component behind both / and /week/[n]. */
export default async function WeekScreen({ week }: { week?: number }) {
  const context = await getSeasonContext();
  const selectedWeek = week ?? context.currentWeek;
  const weekData = await getWeekGames(context.season, selectedWeek);

  return (
    <main className="page">
      <WeekSelector
        selectedWeek={selectedWeek}
        currentWeek={context.currentWeek}
        maxWeek={context.maxWeek}
      />
      {weekData.games.length === 0 ? (
        <div className="banner">No games found for week {selectedWeek}.</div>
      ) : (
        <WeekView weekData={weekData} />
      )}
    </main>
  );
}
