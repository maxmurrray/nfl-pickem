"use client";

import { useState } from "react";

const SIZE_OPTIONS = [
  { key: "twitter", label: "Twitter · 16:9", detail: "1600×900 · best for posts" },
  { key: "square", label: "Square", detail: "1080×1080" },
  { key: "story", label: "Story", detail: "1080×1920 · vertical" },
] as const;

interface DownloadGraphicProps {
  season: number;
  week: number;
}

export default function DownloadGraphic({ season, week }: DownloadGraphicProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(size: string) {
    setBusy(size);
    setError(null);
    try {
      const res = await fetch(
        `/api/graphic?season=${season}&week=${week}&size=${size}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't build the graphic.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dad-vs-rich-week-${week}-${size}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="graphic-box">
      <button
        type="button"
        className="graphic-btn"
        onClick={() => setOpen((v) => !v)}
      >
        📸 Download picks graphic
      </button>
      {open && (
        <div className="graphic-sizes">
          {SIZE_OPTIONS.map(({ key, label, detail }) => (
            <button
              key={key}
              type="button"
              className="graphic-size-btn"
              disabled={busy !== null}
              onClick={() => download(key)}
            >
              <span className="graphic-size-label">
                {busy === key ? "Building…" : label}
              </span>
              <span className="graphic-size-detail">{detail}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
