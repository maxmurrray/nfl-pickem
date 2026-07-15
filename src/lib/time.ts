const EASTERN = "America/New_York";

/** "Thu, Sep 10 · 8:20 PM ET" — always US Eastern, regardless of device. */
export function formatKickoff(iso: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day} · ${time} ET`;
}
