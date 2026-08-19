"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLAYER_IDS, PLAYER_NAMES } from "@/lib/types";
import { usePlayer } from "./PlayerContext";

export default function Header() {
  const { player, ready, setPlayer } = usePlayer();
  const pathname = usePathname();

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-top">
          <Link href="/" className="brand">
            🏈 Bruce <span className="brand-vs">vs</span> Rich
          </Link>
          <div className="player-toggle" role="group" aria-label="Who are you?">
            {PLAYER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`player-toggle-btn ${player === id ? "active" : ""}`}
                onClick={() => setPlayer(id)}
              >
                I&apos;m {PLAYER_NAMES[id]}
              </button>
            ))}
          </div>
        </div>
        <nav className="tabs">
          <Link href="/" className={`tab ${pathname === "/" || pathname.startsWith("/week") ? "active" : ""}`}>
            Games
          </Link>
          <Link
            href="/leaderboard"
            className={`tab ${pathname === "/leaderboard" ? "active" : ""}`}
          >
            Leaderboard
          </Link>
          <Link
            href="/divisions"
            className={`tab ${pathname.startsWith("/divisions") ? "active" : ""}`}
          >
            Divisions
          </Link>
        </nav>
      </div>

      {ready && player === null && (
        <div className="chooser-overlay">
          <div className="chooser-card">
            <div className="chooser-title">Who are you?</div>
            <p className="chooser-sub">
              Your choice is remembered on this device.
            </p>
            {PLAYER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="chooser-btn"
                onClick={() => setPlayer(id)}
              >
                I&apos;m {PLAYER_NAMES[id]}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
