import type { GameSide } from "./types";

/**
 * Per-team display styling for the picks graphic.
 *
 * `card` is the colour a card gets when it is filled for that team (a matchup
 * half, or a pick cell). It is the team's official primary in almost every
 * case. Four teams are deliberate exceptions because their official primary is
 * literal black or near-black, which disappears against the graphic's black
 * background:
 *
 *   LV  black       -> silver    PIT black  -> gold
 *   JAX black       -> teal      CLE brown  -> orange
 *
 * `whiteLogo` means: on that team's own card colour, ESPN's full-colour logo
 * is too low-contrast (navy logo on a navy card, etc.), so use ESPN's
 * "500-dark" variant, which is the white-on-transparent version.
 */
export interface TeamStyle {
  card: string;
  whiteLogo?: boolean;
}

export const TEAM_STYLES: Record<string, TeamStyle> = {
  ARI: { card: "#97233F" },
  ATL: { card: "#A71930" },
  BAL: { card: "#241773", whiteLogo: true },
  BUF: { card: "#00338D", whiteLogo: true },
  CAR: { card: "#0085CA", whiteLogo: true },
  CHI: { card: "#0B162A" },
  CIN: { card: "#FB4F14" },
  CLE: { card: "#FF3C00" }, // official primary is brown #311D00 — too dark on black
  DAL: { card: "#041E42", whiteLogo: true },
  DEN: { card: "#FB4F14" },
  DET: { card: "#0076B6" },
  GB: { card: "#203731" },
  HOU: { card: "#03202F" },
  IND: { card: "#002C5F", whiteLogo: true },
  JAX: { card: "#006778" }, // official primary is black
  KC: { card: "#E31837" },
  LAC: { card: "#0080C6" },
  LAR: { card: "#003594", whiteLogo: true },
  LV: { card: "#A5ACAF" }, // official primary is black
  MIA: { card: "#008E97" },
  MIN: { card: "#4F2683" },
  NE: { card: "#002244" },
  NO: { card: "#D3BC8D" },
  NYG: { card: "#0B2265", whiteLogo: true },
  NYJ: { card: "#125740", whiteLogo: true },
  PHI: { card: "#004C54" },
  PIT: { card: "#FFB612" }, // official primary is black
  SEA: { card: "#002244" },
  SF: { card: "#AA0000" },
  TB: { card: "#D50A0A" },
  TEN: { card: "#0C2340" },
  WSH: { card: "#5A1414" },
};

/** Card colour for a team, falling back to ESPN's own colour then neutral. */
export function teamCard(side: GameSide): string {
  const style = TEAM_STYLES[side.abbreviation];
  if (style) return style.card;
  return side.color ? `#${side.color}` : "#333A45";
}

/**
 * Logo URL for a team as it will appear on its own card colour. ESPN serves a
 * white variant under /nfl/500-dark/ for the teams that need one.
 */
export function teamLogo(side: GameSide): string | null {
  if (!side.logo) return null;
  return TEAM_STYLES[side.abbreviation]?.whiteLogo
    ? side.logo.replace("/nfl/500/", "/nfl/500-dark/")
    : side.logo;
}

/** Perceived lightness (0–1) of a #rrggbb colour — used for text/edge contrast. */
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Perceptual colour difference (CIE76 ΔE) between two card colours.
 *
 * Plain RGB distance was the first attempt and it was wrong in both
 * directions: it scores any two dark colours as "similar" regardless of hue,
 * and it flagged Denver's orange against Kansas City's red — obviously
 * distinguishable — at almost exactly the same value as pairs that genuinely
 * merge. Lab separates lightness from chroma, so the number actually tracks
 * "can you see the boundary".
 */
function toLab(hex: string): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = channels(hex).map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function colorDistance(a: string, b: string): number {
  const A = toLab(a);
  const B = toLab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/**
 * Below this ΔE two teams' colours genuinely read as one block and the matchup
 * card needs a crease down the middle. Measured against all 496 possible
 * pairings: the true collisions (Cincinnati/Denver and New England/Seattle are
 * both exactly 0, Carolina/Chargers 2.3, Dallas/New England 3.2, Chicago/
 * Houston 8.3) all sit under 9, and the next pairing up is far clear of it.
 */
export const SAME_COLOR_THRESHOLD = 10;

export function needsDivider(awayCard: string, homeCard: string): boolean {
  return colorDistance(awayCard, homeCard) < SAME_COLOR_THRESHOLD;
}

/* --------------------------------------------------------------------------
   Shading helpers for the glass card treatment.
   -------------------------------------------------------------------------- */

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [
    number,
    number,
    number,
  ];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix toward white. amount 0–1. */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return toHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount
  );
}

/** Mix toward black. amount 0–1. */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = channels(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
