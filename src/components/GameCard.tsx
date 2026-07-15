"use client";

import Image from "next/image";
import { gameResult, isPickCorrect } from "@/lib/grading";
import { formatKickoff } from "@/lib/time";
import {
  PLAYER_NAMES,
  otherPlayer,
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

function TeamButton({
  side,
  game,
  picked,
  locked,
  disabled,
  onPick,
}: {
  side: GameSide;
  game: Game;
  picked: boolean;
  locked: boolean;
  disabled: boolean;
  onPick: (teamId: string) => void;
}) {
  const result = gameResult(game);
  const isWinner =
    result.finished && (result.tie || result.winnerTeamId === side.teamId);
  const showScore = game.state !== "pre" && side.score !== null;

  const classes = ["team-btn"];
  if (picked) classes.push("picked");
  if (locked) classes.push("locked");
  if (result.finished && !isWinner) classes.push("loser");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled}
      onClick={() => onPick(side.teamId)}
      style={
        picked && side.color
          ? ({ "--team-color": `#${side.color}` } as React.CSSProperties)
          : undefined
      }
      aria-pressed={picked}
    >
      {side.logo ? (
        <Image
          src={side.logo}
          alt=""
          width={44}
          height={44}
          className="team-logo"
          unoptimized
        />
      ) : (
        <span className="team-logo team-logo-fallback">{side.abbreviation}</span>
      )}
      <span className="team-name">{side.shortDisplayName}</span>
      {showScore ? (
        <span className={`team-score ${isWinner ? "winner" : ""}`}>
          {side.score}
        </span>
      ) : (
        <span className={`pick-check ${picked ? "on" : ""}`} aria-hidden>
          ✓
        </span>
      )}
    </button>
  );
}

function PickChip({
  label,
  game,
  teamId,
}: {
  label: string;
  game: Game;
  teamId: string | undefined;
}) {
  const finished = game.completed;
  if (!teamId) {
    return (
      <span className={`pick-chip ${finished ? "wrong" : ""}`}>
        {label}: no pick{finished ? " ✗" : ""}
      </span>
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
    <span className={`pick-chip ${cls}`}>
      {label}: {team?.abbreviation ?? "?"}
      {finished ? (correct ? " ✓" : " ✗") : ""}
    </span>
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
  const opp = player ? otherPlayer(player) : null;

  return (
    <div className={`game-card ${game.state === "in" ? "live" : ""}`}>
      <div className="game-meta">
        <span className="game-time">
          {game.state === "in" ? game.statusDetail : formatKickoff(game.kickoff)}
          {game.state === "pre" && game.broadcast ? ` · ${game.broadcast}` : ""}
        </span>
        <span className={`game-state state-${game.state} ${locked ? "locked" : ""}`}>
          {game.state === "in"
            ? "● LIVE"
            : game.completed
              ? "Final"
              : locked
                ? "🔒 Locked"
                : "Open"}
        </span>
      </div>

      <div className="matchup">
        <TeamButton
          side={game.away}
          game={game}
          picked={myPick === game.away.teamId}
          locked={locked}
          disabled={locked || !player}
          onPick={onPick}
        />
        <span className="at-sign">@</span>
        <TeamButton
          side={game.home}
          game={game}
          picked={myPick === game.home.teamId}
          locked={locked}
          disabled={locked || !player}
          onPick={onPick}
        />
      </div>

      <div className="game-footer">
        {locked && player && opp ? (
          <>
            <PickChip label={PLAYER_NAMES[player]} game={game} teamId={myPick} />
            <PickChip label={PLAYER_NAMES[opp]} game={game} teamId={oppPick} />
          </>
        ) : (
          <span className="footer-hint">
            {myPick
              ? "Pick saved — you can change it until kickoff."
              : "Tap a team to pick. Locks at kickoff."}
          </span>
        )}
      </div>
    </div>
  );
}
