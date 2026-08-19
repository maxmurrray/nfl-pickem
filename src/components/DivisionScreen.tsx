"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CONFERENCES,
  DIVISIONS,
  type Conference,
  type Division,
  type DivisionGroup,
} from "@/lib/divisions";
import { usePlayer } from "./PlayerContext";

interface Props {
  season: number;
  groups: Record<Conference, DivisionGroup[]>;
  initialLocked: boolean;
  lockTime: number | null;
}

// Bruce is 'dad' internally; the predictions table stores 'bruce'.
function dbPlayer(p: "dad" | "rich"): "bruce" | "rich" {
  return p === "dad" ? "bruce" : "rich";
}

interface Entry {
  abbr: string;
  wins: string; // kept as strings so fields can be blank while typing
  losses: string;
}
type Board = Record<Conference, Record<Division, Entry[]>>;

interface ApiPrediction {
  player: "bruce" | "rich";
  conference: Conference;
  division: Division;
  teamAbbr: string;
  rank: number;
  wins: number;
  losses: number;
}

function blankBoard(groups: Record<Conference, DivisionGroup[]>): Board {
  const board = {} as Board;
  for (const conf of CONFERENCES) {
    board[conf] = {} as Record<Division, Entry[]>;
    for (const group of groups[conf]) {
      board[conf][group.division] = group.teams.map((t) => ({
        abbr: t.abbr,
        wins: "",
        losses: "",
      }));
    }
  }
  return board;
}

function clampInt(raw: string): number | null {
  if (raw === "") return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(17, n));
}

export default function DivisionScreen({ season, groups, initialLocked, lockTime }: Props) {
  const { player, ready } = usePlayer();
  const [conf, setConf] = useState<Conference>("AFC");
  const [board, setBoard] = useState<Board>(() => blankBoard(groups));
  const [locked, setLocked] = useState(initialLocked);
  const [saving, setSaving] = useState<Conference | null>(null);
  const [savedAt, setSavedAt] = useState<Partial<Record<Conference, string>>>({});
  const [error, setError] = useState<string | null>(null);

  // Team metadata lookup (logos/names) for rendering rows.
  const metaByAbbr = useMemo(() => {
    const m = new Map<string, DivisionGroup["teams"][number]>();
    for (const c of CONFERENCES) for (const g of groups[c]) for (const t of g.teams) m.set(t.abbr, t);
    return m;
  }, [groups]);

  // Load this player's saved predictions and overlay them onto the board.
  useEffect(() => {
    if (!ready || !player) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/predictions?season=${season}&player=${player}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.locked === "boolean") setLocked(data.locked);
        const mine = (data.predictions as ApiPrediction[]).filter(
          (p) => p.player === dbPlayer(player)
        );
        if (mine.length === 0) return;
        setBoard((prev) => {
          const next = structuredClone(prev) as Board;
          const byDiv = new Map<string, ApiPrediction[]>();
          for (const p of mine) {
            const key = `${p.conference}:${p.division}`;
            byDiv.set(key, [...(byDiv.get(key) ?? []), p]);
          }
          for (const [key, preds] of byDiv) {
            const [c, d] = key.split(":") as [Conference, Division];
            if (preds.length !== 4) continue;
            next[c][d] = [...preds]
              .sort((a, b) => a.rank - b.rank)
              .map((p) => ({ abbr: p.teamAbbr, wins: String(p.wins), losses: String(p.losses) }));
          }
          return next;
        });
      } catch {
        /* keep the blank board */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, player, season]);

  function move(division: Division, index: number, dir: -1 | 1) {
    if (locked) return;
    setBoard((prev) => {
      const list = prev[conf][division];
      const j = index + dir;
      if (j < 0 || j >= list.length) return prev;
      const next = structuredClone(prev) as Board;
      const arr = next[conf][division];
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return next;
    });
  }

  function setRecord(division: Division, index: number, field: "wins" | "losses", raw: string) {
    if (locked) return;
    const cleaned = raw.replace(/[^0-9]/g, "").slice(0, 2);
    setBoard((prev) => {
      const next = structuredClone(prev) as Board;
      const entry = next[conf][division][index];
      const n = clampInt(cleaned);
      if (field === "wins") {
        entry.wins = n === null ? "" : String(n);
        entry.losses = n === null ? entry.losses : String(17 - n);
      } else {
        entry.losses = n === null ? "" : String(n);
        entry.wins = n === null ? entry.wins : String(17 - n);
      }
      return next;
    });
  }

  // Soft, non-blocking warnings: a lower-ranked team projected to win more than
  // a higher-ranked team in the same division.
  const warnings = useMemo(() => {
    const out: Record<Division, boolean> = {} as Record<Division, boolean>;
    for (const division of DIVISIONS) {
      const list = board[conf][division];
      let warn = false;
      for (let i = 0; i < list.length && !warn; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const wi = list[i].wins === "" ? null : Number(list[i].wins);
          const wj = list[j].wins === "" ? null : Number(list[j].wins);
          if (wi !== null && wj !== null && wj > wi) {
            warn = true;
            break;
          }
        }
      }
      out[division] = warn;
    }
    return out;
  }, [board, conf]);

  async function save() {
    if (!player || locked) return;
    // Validate: every team has a complete 0–17 record summing to 17.
    const predictions: {
      division: Division;
      teamAbbr: string;
      rank: number;
      wins: number;
      losses: number;
    }[] = [];
    for (const division of DIVISIONS) {
      const list = board[conf][division];
      for (let i = 0; i < list.length; i++) {
        const w = list[i].wins;
        const l = list[i].losses;
        if (w === "" || l === "") {
          setError(`Fill in every record in ${conf} ${division} (they must total 17).`);
          return;
        }
        predictions.push({
          division,
          teamAbbr: list[i].abbr,
          rank: i + 1,
          wins: Number(w),
          losses: Number(l),
        });
      }
    }

    setSaving(conf);
    setError(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player, season, conference: conf, predictions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) setLocked(true);
        throw new Error(data.error ?? "Couldn't save predictions.");
      }
      setSavedAt((prev) => ({ ...prev, [conf]: new Date().toLocaleTimeString() }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(null);
    }
  }

  if (ready && !player) {
    return (
      <main className="page">
        <div className="banner">Choose who you are (top right) to make your predictions.</div>
      </main>
    );
  }

  const accent = conf === "AFC" ? "#CE1126" : "#143D66";

  return (
    <main className="page div-screen">
      <h1 className="div-title">Division Predictions</h1>
      <p className="div-sub">
        Rank all four teams in every division and project a 17-game record.
        {locked ? " Predictions are locked — both players are now revealed." : " Only you can see yours until the season kicks off."}
      </p>

      {/* Conference segmented control */}
      <div className="seg" role="group" aria-label="Conference">
        {CONFERENCES.map((c) => (
          <button
            key={c}
            type="button"
            className={`seg-btn ${conf === c ? "active" : ""}`}
            style={conf === c ? { background: c === "AFC" ? "#CE1126" : "#143D66" } : undefined}
            onClick={() => setConf(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Division cards */}
      <div className="div-grid">
        {DIVISIONS.map((division) => {
          const list = board[conf][division];
          return (
            <section key={division} className="div-card">
              <div className="div-card-head" style={{ background: accent }}>
                {division.toUpperCase()}
              </div>
              <div className="div-card-cols">
                <span className="dcc dcc-rank">#</span>
                <span className="dcc dcc-team">TEAM</span>
                <span className="dcc dcc-rec">W · L</span>
              </div>
              {list.map((entry, i) => {
                const meta = metaByAbbr.get(entry.abbr);
                return (
                  <div key={entry.abbr} className="div-team-row">
                    <div className="rank-col">
                      <span className="rank-badge">{i + 1}</span>
                      <div className="reorder">
                        <button
                          type="button"
                          className="reorder-btn"
                          aria-label={`Move ${entry.abbr} up`}
                          disabled={locked || i === 0}
                          onClick={() => move(division, i, -1)}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="reorder-btn"
                          aria-label={`Move ${entry.abbr} down`}
                          disabled={locked || i === list.length - 1}
                          onClick={() => move(division, i, 1)}
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                    <div className="team-cell">
                      {meta?.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="dt-logo" src={meta.logo} alt="" width={28} height={28} />
                      ) : (
                        <span className="dt-logo" />
                      )}
                      <span className="dt-abbr">{entry.abbr}</span>
                    </div>
                    <div className="rec-inputs">
                      <input
                        className="rec-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="W"
                        value={entry.wins}
                        disabled={locked}
                        onChange={(e) => setRecord(division, i, "wins", e.target.value)}
                      />
                      <span className="rec-dash">-</span>
                      <input
                        className="rec-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="L"
                        value={entry.losses}
                        disabled={locked}
                        onChange={(e) => setRecord(division, i, "losses", e.target.value)}
                      />
                    </div>
                  </div>
                );
              })}
              {warnings[division] && (
                <div className="warn-note">
                  ⚠ A lower-ranked team is projected to win more than a higher one.
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Save row */}
      {!locked && (
        <div className="div-save-row">
          <button
            type="button"
            className="save-btn"
            disabled={saving !== null}
            onClick={save}
            style={{ background: accent }}
          >
            {saving === conf ? "Saving…" : `Save ${conf} predictions`}
          </button>
          {savedAt[conf] && <span className="saved-note">Saved · {savedAt[conf]}</span>}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}

      {/* Graphics */}
      <GraphicsPanel season={season} player={player} locked={locked} lockTime={lockTime} />
    </main>
  );
}

function GraphicsPanel({
  season,
  player,
  locked,
  lockTime,
}: {
  season: number;
  player: "dad" | "rich" | null;
  locked: boolean;
  lockTime: number | null;
}) {
  const [busy, setBusy] = useState<Conference | null>(null);
  const [error, setError] = useState<string | null>(null);

  // After lock the graphic shows both players; before lock each player can
  // export just their own single-column version (opponent stays hidden).
  const src = (conference: Conference) =>
    locked
      ? `/api/division-graphic?season=${season}&conference=${conference}`
      : `/api/division-graphic?season=${season}&conference=${conference}&player=${player}`;

  async function download(conference: Conference) {
    if (!player) return;
    setBusy(conference);
    setError(null);
    try {
      const res = await fetch(src(conference));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't build the graphic.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const who = player === "dad" ? "bruce" : "rich";
      const a = document.createElement("a");
      a.href = url;
      a.download = locked
        ? `bruce-vs-rich-${conference.toLowerCase()}-predictions.png`
        : `${who}-${conference.toLowerCase()}-predictions.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  const lockLabel = lockTime
    ? new Date(lockTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "kickoff";

  return (
    <section className="graphics-panel">
      <h2 className="graphics-title">Graphics</h2>
      <p className="locked-note">
        {locked
          ? "Both players are revealed — download the head-to-head graphics."
          : `These show only your picks for now. Both players go head-to-head after the first kickoff (${lockLabel}).`}
      </p>
      <div className="gfx-grid">
        {CONFERENCES.map((conference) => (
          <div key={conference} className="gfx-item">
            {player ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="gfx-preview"
                src={src(conference)}
                alt={`${conference} predictions preview`}
              />
            ) : (
              <div className="gfx-preview gfx-preview-empty">{conference}</div>
            )}
            <button
              type="button"
              className="gfx-btn"
              disabled={!player || busy !== null}
              onClick={() => download(conference)}
            >
              {busy === conference
                ? "Building…"
                : locked
                  ? `Download ${conference}`
                  : `Download ${conference} (yours)`}
            </button>
          </div>
        ))}
      </div>
      {error && <div className="banner error">{error}</div>}
    </section>
  );
}
