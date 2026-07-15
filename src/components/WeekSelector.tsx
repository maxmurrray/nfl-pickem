import Link from "next/link";

interface WeekSelectorProps {
  selectedWeek: number;
  currentWeek: number;
  maxWeek: number;
}

export default function WeekSelector({
  selectedWeek,
  currentWeek,
  maxWeek,
}: WeekSelectorProps) {
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  return (
    <nav className="week-selector" aria-label="Choose week">
      {weeks.map((week) => {
        const isCurrent = week === currentWeek;
        const href = isCurrent ? "/" : `/week/${week}`;
        return (
          <Link
            key={week}
            href={href}
            className={`week-pill ${week === selectedWeek ? "active" : ""} ${
              isCurrent ? "current" : ""
            }`}
          >
            {isCurrent ? `Wk ${week} ★` : `Wk ${week}`}
          </Link>
        );
      })}
    </nav>
  );
}
