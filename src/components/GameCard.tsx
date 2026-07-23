"use client";

import Image from "next/image";
import { gameResult, isPickCorrect } from "@/lib/grading";
import {
  PLAYER_IDS,
  PLAYER_NAMES,
  type Game,
  type GameSide,
  type PlayerId,
} from "@/lib/types";

interface GameCardProps {
  game: Game;
  locked: boolean;
  player: PlayerId | null;
  myPick: string | undefined;
  oppPick: string | undefined;
  onPick: (teamId: string) => void;
}

/** One tappable team in the matchup. Team color drives the left stripe,
 *  the ~12% selected-tint, and the ring/glow — never a full fill. */
function TeamButton({
  side,
  game,
  picked,
  dimmed,
  disabled,
  onPick,
}: {
  side: GameSide;
  game: Game;
  picked: boolean;
  dimmed: boolean;
  disabled: boolean;
  onPick: (teamId: string) => void;
}) {
  const result = gameResult(game);
  const isWinner =
    result.finished && (result.tie || result.winnerTeamId === side.teamId);
  const isLoser = result.finished && !isWinner;
  const showScore = game.state !== "pre" && side.score !== null;

  const classes = ["team-btn"];
  if (picked) classes.push("picked");
  if (dimmed) classes.push("dimmed");
  if (isWinner) classes.push("winner");
  if (isLoser) classes.push("loser");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled}
      onClick={() => onPick(side.teamId)}
      // --team-color feeds the stripe, tint (--tint-opacity) and glow.
      style={
        side.color
          ? ({ "--team-color": `#${side.color}` } as React.CSSProperties)
          : undefined
      }
      aria-pressed={picked}
    >
      {side.logo ? (
        <Image
          src={side.logo}
          alt=""
          width={34}
          height={34}
          className="team-logo"
          unoptimized
        />
      ) : (
        <span className="team-logo-fallback">{side.abbreviation}</span>
      )}
      <span className="team-abbr">{side.abbreviation}</span>
      {showScore && (
        <span className={`team-score ${isWinner ? "winner" : ""}`}>
          {side.score}
        </span>
      )}
    </button>
  );
}

/** A player's pick, shown as a small logo chip. Opponent stays masked until
 *  the game locks (same reveal rule as before). */
function PickSlot({
  name,
  teamId,
  revealed,
  game,
}: {
  name: string;
  teamId: string | undefined;
  revealed: boolean;
  game: Game;
}) {
  const finished = game.completed;

  if (!revealed) {
    return (
      <div className="pick-slot">
        <span className="pick-slot-name">{name}</span>
        <span className="pick-chip hidden" aria-label="hidden until kickoff">
          🔒
        </span>
      </div>
    );
  }

  if (!teamId) {
    return (
      <div className="pick-slot">
        <span className="pick-slot-name">{name}</span>
        <span className={`pick-chip empty ${finished ? "wrong" : ""}`}>
          no pick{finished ? " ✗" : ""}
        </span>
      </div>
    );
  }

  const team =
    game.home.teamId === teamId
      ? game.home
      : game.away.teamId === teamId
        ? game.away
        : null;
  const correct = isPickCorrect(game, teamId);
  const cls = finished ? (correct ? "right" : "wrong") : "";

  return (
    <div className="pick-slot">
      <span className="pick-slot-name">{name}</span>
      <span className={`pick-chip ${cls}`}>
        {team?.logo && (
          <Image
            src={team.logo}
            alt=""
            width={16}
            height={16}
            className="chip-logo"
            unoptimized
          />
        )}
        {team?.abbreviation ?? "?"}
        {finished ? (correct ? " ✓" : " ✗") : ""}
      </span>
    </div>
  );
}

export default function GameCard({
  game,
  locked,
  player,
  myPick,
  oppPick,
  onPick,
}: GameCardProps) {
  const result = gameResult(game);
  const hasPick = !!myPick;

  // Both players, stable dad → rich order. My own pick is always visible;
  // the opponent's is revealed only once the game locks (unchanged rule).
  const slots = PLAYER_IDS.map((pid) => {
    const isMe = player === pid;
    return {
      pid,
      teamId: isMe ? myPick : player ? oppPick : undefined,
      revealed: isMe || locked,
    };
  });

  return (
    <article
      className={`game-card ${game.state === "in" ? "live" : ""} ${
        game.completed ? "final" : ""
      }`}
    >
      <div className="gamecard-meta">
        <span className="gc-broadcast">
          {game.state === "in"
            ? game.statusDetail
            : game.state === "pre" && game.broadcast
              ? game.broadcast
              : ""}
        </span>
        <span className={`gc-status status-${game.state} ${locked ? "locked" : ""}`}>
          {game.state === "in"
            ? "● LIVE"
            : game.completed
              ? "Final"
              : locked
                ? "🔒 Locked"
                : "Open"}
        </span>
      </div>

      <div className="gamecard-body">
        <div className="matchup">
          <TeamButton
            side={game.away}
            game={game}
            picked={myPick === game.away.teamId}
            dimmed={!result.finished && hasPick && myPick !== game.away.teamId}
            disabled={locked || !player}
            onPick={onPick}
          />
          <span className="at-sign">at</span>
          <TeamButton
            side={game.home}
            game={game}
            picked={myPick === game.home.teamId}
            dimmed={!result.finished && hasPick && myPick !== game.home.teamId}
            disabled={locked || !player}
            onPick={onPick}
          />
        </div>

        <div className="picks">
          {slots.map((s) => (
            <PickSlot
              key={s.pid}
              name={PLAYER_NAMES[s.pid]}
              teamId={s.teamId}
              revealed={s.revealed}
              game={game}
            />
          ))}
        </div>
      </div>
    </article>
  );
}
