"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRecord, gradeWeek } from "@/lib/grading";
import {
  PLAYER_NAMES,
  isGameLocked,
  otherPlayer,
  type WeekData,
  type WeekPicks,
} from "@/lib/types";
import DownloadGraphic from "./DownloadGraphic";
import GameCard from "./GameCard";
import { usePlayer } from "./PlayerContext";

interface WeekViewProps {
  weekData: WeekData;
}

export default function WeekView({ weekData }: WeekViewProps) {
  const { player, ready } = usePlayer();
  const router = useRouter();
  const { season, week, games } = weekData;

  const [picks, setPicks] = useState<WeekPicks | null>(null);
  const [counts, setCounts] = useState<{ dad: number; rich: number } | null>(
    null
  );
  const [persistent, setPersistent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Client clock tick so cards flip to "locked" as kickoffs pass.
  const [now, setNow] = useState(() => Date.now());

  const loadPicks = useCallback(async () => {
    if (!player) return;
    try {
      const res = await fetch(
        `/api/picks?season=${season}&week=${week}&player=${player}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPicks(data.picks);
      setCounts(data.counts ?? null);
      setPersistent(data.persistent);
      setError(null);
    } catch {
      setError("Couldn't load picks. Check your connection and refresh.");
    }
  }, [season, week, player]);

  useEffect(() => {
    setPicks(null);
    loadPicks();
  }, [loadPicks]);

  // Refresh clock + picks every 30s; refresh server data (scores) every
  // 60s while any game is live.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      loadPicks();
    }, 30_000);
    const anyLive = games.some((g) => g.state === "in");
    const scores = anyLive
      ? setInterval(() => router.refresh(), 60_000)
      : undefined;
    return () => {
      clearInterval(tick);
      if (scores) clearInterval(scores);
    };
  }, [games, loadPicks, router]);

  const makePick = useCallback(
    async (gameId: string, teamId: string) => {
      if (!player) return;
      const previous = picks;
      // Optimistic update; revert on rejection.
      setPicks((current) => ({
        ...(current ?? {}),
        [gameId]: { ...(current?.[gameId] ?? {}), [player]: teamId },
      }));
      try {
        const res = await fetch("/api/picks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player, season, week, gameId, teamId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setPicks(previous);
          setError(data.error ?? "Pick was rejected.");
          setTimeout(() => setError(null), 4000);
          loadPicks();
        }
      } catch {
        setPicks(previous);
        setError("Couldn't save your pick — are you online?");
        setTimeout(() => setError(null), 4000);
      }
    },
    [player, picks, season, week, loadPicks]
  );

  const records = useMemo(
    () => gradeWeek(games, picks ?? {}),
    [games, picks]
  );
  const completedCount = games.filter((g) => g.completed).length;
  const myPickCount = player
    ? games.filter((g) => picks?.[g.id]?.[player]).length
    : 0;
  const bothComplete =
    counts !== null &&
    games.length > 0 &&
    counts.dad >= games.length &&
    counts.rich >= games.length;
  const waitingOnOpponent =
    !bothComplete &&
    counts !== null &&
    player !== null &&
    counts[player] >= games.length &&
    games.length > 0;

  return (
    <div>
      <div className="score-strip">
        <div className="score-strip-title">Week {week}</div>
        <div className="score-strip-score">
          {completedCount > 0 ? (
            <>
              <span>
                {PLAYER_NAMES.dad} <strong>{formatRecord(records.dad)}</strong>
              </span>
              <span className="dot">·</span>
              <span>
                {PLAYER_NAMES.rich} <strong>{formatRecord(records.rich)}</strong>
              </span>
            </>
          ) : (
            <span className="muted">
              {player && picks
                ? `You've picked ${myPickCount} of ${games.length} games`
                : "No finals yet"}
            </span>
          )}
        </div>
      </div>

      {bothComplete && <DownloadGraphic season={season} week={week} />}
      {waitingOnOpponent && player && (
        <div className="banner">
          ✅ All your picks are in. The downloadable picks graphic unlocks
          once {PLAYER_NAMES[otherPlayer(player)]} finishes too.
        </div>
      )}

      {!persistent && (
        <div className="banner warn">
          Supabase isn&apos;t configured — picks are stored in temporary server
          memory and will not survive a restart or deploy.
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      <div className="game-list">
        {games.map((game) => {
          const locked = isGameLocked(game, now);
          return (
            <GameCard
              key={game.id}
              game={game}
              locked={locked}
              player={player && ready ? player : null}
              myPick={player ? picks?.[game.id]?.[player] : undefined}
              oppPick={
                player ? picks?.[game.id]?.[otherPlayer(player)] : undefined
              }
              onPick={(teamId) => makePick(game.id, teamId)}
            />
          );
        })}
      </div>
    </div>
  );
}
