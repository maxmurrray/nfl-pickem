"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// `x` is the one built for the timeline (4:5, 2160×2700). The other two are
// the same layout on an Instagram canvas.
const SIZE_OPTIONS = [
  { key: "x", label: "X · 4:5", detail: "2160×2700" },
  { key: "square", label: "Square", detail: "2160×2160" },
  { key: "story", label: "Story", detail: "2160×3840" },
] as const;

const PREVIEW_SIZE = "x";
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

interface DownloadGraphicProps {
  season: number;
  week: number;
}

export default function DownloadGraphic({ season, week }: DownloadGraphicProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // The finishing pass runs one to two minutes, so it reports progress.
  const [polished, setPolished] = useState<string | null>(null);
  const [polishNote, setPolishNote] = useState<string | null>(null);

  const previewUrl = useRef<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    return () => {
      cancelled.current = true;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  const fetchGraphic = useCallback(
    async (size: string): Promise<Blob> => {
      const res = await fetch(
        `/api/graphic?season=${season}&week=${week}&size=${size}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Couldn't build the graphic.");
      }
      return res.blob();
    },
    [season, week]
  );

  async function showPreview() {
    setBusy("preview");
    setError(null);
    try {
      const blob = await fetchGraphic(PREVIEW_SIZE);
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview(url);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  /** Render the board, hand it to the image model, poll until it comes back. */
  async function finishWithModel() {
    setBusy("polish");
    setError(null);
    setPolished(null);
    setPolishNote("Rendering the board…");
    try {
      const res = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season, week, size: PREVIEW_SIZE }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Finishing pass failed.");

      // Gemini answers in one shot; Higgsfield queues a job.
      if (data.dataUri) {
        setPolished(data.dataUri);
        setPolishNote(null);
        return;
      }
      if (!data.requestId) throw new Error("No request id returned.");

      const started = Date.now();
      setPolishNote("Queued with Nano Banana… this takes a minute or two.");
      while (!cancelled.current) {
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          throw new Error("Timed out waiting for the finishing pass.");
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        const s = await fetch(`/api/polish?id=${data.requestId}`).then((r) =>
          r.json()
        );
        if (s.status === "completed" && s.url) {
          setPolished(s.url);
          setPolishNote(null);
          return;
        }
        if (s.status === "failed") {
          throw new Error(s.error ?? "The model couldn't finish this one.");
        }
        const secs = Math.round((Date.now() - started) / 1000);
        setPolishNote(
          `${s.status === "in_progress" ? "Working" : "Queued"}… ${secs}s`
        );
      }
    } catch (e) {
      setPolishNote(null);
      setError(e instanceof Error ? e.message : "Finishing pass failed.");
    } finally {
      setBusy(null);
    }
  }

  async function download(size: string) {
    setBusy(size);
    setError(null);
    try {
      const blob = await fetchGraphic(size);
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `week-${week}-picks.png`);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPolished() {
    if (!polished) return;
    setBusy("polished-dl");
    setError(null);
    try {
      // Remote CDN URL or a data URI — fetch covers both.
      const blob = await fetch(polished).then((r) => r.blob());
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `week-${week}-picks-finished.jpg`);
      URL.revokeObjectURL(url);
    } catch {
      // Cross-origin fetch can be blocked; fall back to opening it.
      window.open(polished, "_blank");
    } finally {
      setBusy(null);
    }
  }

  function triggerDownload(url: string, name: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="graphic-box">
      <button
        type="button"
        className="graphic-btn"
        disabled={busy !== null}
        onClick={() => (open ? setOpen(false) : showPreview())}
      >
        {busy === "preview"
          ? "Building…"
          : open
            ? "Hide picks graphic"
            : "📸 Preview picks graphic"}
      </button>

      {open && preview && (
        <div className="graphic-preview">
          {/* Shown at roughly phone-feed width so the text is judged at the
              size followers actually see it. */}
          <div className="graphic-pair">
            <figure>
              <img src={preview} alt={`Week ${week} picks graphic`} />
              <figcaption>Clean render · always correct</figcaption>
            </figure>
            {polished && (
              <figure>
                <img src={polished} alt={`Week ${week} finished graphic`} />
                <figcaption>Finished by the model · check it</figcaption>
              </figure>
            )}
          </div>
        </div>
      )}

      {open && (
        <>
          <button
            type="button"
            className="graphic-polish-btn"
            disabled={busy !== null}
            onClick={finishWithModel}
          >
            {busy === "polish"
              ? (polishNote ?? "Working…")
              : "✨ Finish with Nano Banana"}
          </button>
          {polished && (
            <button
              type="button"
              className="graphic-polish-btn secondary"
              disabled={busy !== null}
              onClick={downloadPolished}
            >
              {busy === "polished-dl"
                ? "Saving…"
                : "⬇ Download the finished version"}
            </button>
          )}
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
        </>
      )}

      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
