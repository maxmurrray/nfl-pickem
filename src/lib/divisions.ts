// Division structure for the Division Predictions feature.
//
// The scoreboard API this app already uses doesn't expose conference/division
// grouping, so we keep the canonical NFL map static (it hasn't changed since
// 2002) and join it with ESPN's teams endpoint for logos, colors, and names.

export type Conference = "AFC" | "NFC";
export type Division = "East" | "North" | "South" | "West";

export const CONFERENCES: Conference[] = ["AFC", "NFC"];
export const DIVISIONS: Division[] = ["East", "North", "South", "West"];

// Team order here is the default/placeholder finishing order (used before a
// player submits, and as the initial rank order in the input UI).
export const DIVISION_TEAMS: Record<Conference, Record<Division, string[]>> = {
  AFC: {
    East: ["BUF", "MIA", "NE", "NYJ"],
    North: ["BAL", "CIN", "CLE", "PIT"],
    South: ["HOU", "IND", "JAX", "TEN"],
    West: ["KC", "LAC", "DEN", "LV"],
  },
  NFC: {
    East: ["PHI", "DAL", "NYG", "WSH"],
    North: ["DET", "GB", "MIN", "CHI"],
    South: ["TB", "ATL", "CAR", "NO"],
    West: ["SF", "LAR", "SEA", "ARI"],
  },
};

export interface DivisionTeam {
  abbr: string;
  displayName: string;
  shortName: string;
  logo: string; // ESPN primary mark
  color: string | null;
}

export interface DivisionGroup {
  conference: Conference;
  division: Division;
  teams: DivisionTeam[]; // in DIVISION_TEAMS default order
}

const TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";

// Fallback logo URL pattern when the teams endpoint is unavailable.
function fallbackLogo(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
}

let metaCache: Map<string, DivisionTeam> | null | undefined;

/** abbr → team metadata (logo/color/name). Cached; falls back to synthesized. */
export async function getTeamMeta(): Promise<Map<string, DivisionTeam>> {
  if (metaCache) return metaCache;
  const map = new Map<string, DivisionTeam>();
  try {
    const res = await fetch(TEAMS_URL, { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`teams ${res.status}`);
    const data = await res.json();
    const teams: any[] = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    for (const entry of teams) {
      const t = entry?.team ?? {};
      const abbr = t.abbreviation;
      if (!abbr) continue;
      map.set(abbr, {
        abbr,
        displayName: t.displayName ?? abbr,
        shortName: t.shortDisplayName ?? t.name ?? abbr,
        logo: t.logos?.[0]?.href ?? fallbackLogo(abbr),
        color: t.color ? `#${String(t.color).replace(/^#/, "")}` : null,
      });
    }
  } catch {
    // Synthesize from the static map so the feature still works offline.
  }
  // Ensure every mapped team has an entry (fills gaps from the static roster).
  for (const conf of CONFERENCES) {
    for (const div of DIVISIONS) {
      for (const abbr of DIVISION_TEAMS[conf][div]) {
        if (!map.has(abbr)) {
          map.set(abbr, {
            abbr,
            displayName: abbr,
            shortName: abbr,
            logo: fallbackLogo(abbr),
            color: null,
          });
        }
      }
    }
  }
  metaCache = map;
  return map;
}

/** All divisions for one conference, teams in default order, with metadata. */
export async function getConferenceGroups(
  conference: Conference
): Promise<DivisionGroup[]> {
  const meta = await getTeamMeta();
  return DIVISIONS.map((division) => ({
    conference,
    division,
    teams: DIVISION_TEAMS[conference][division].map((abbr) => meta.get(abbr)!),
  }));
}

/** The conference+division an abbreviation belongs to, or null if unknown. */
export function locateTeam(
  abbr: string
): { conference: Conference; division: Division } | null {
  for (const conference of CONFERENCES) {
    for (const division of DIVISIONS) {
      if (DIVISION_TEAMS[conference][division].includes(abbr)) {
        return { conference, division };
      }
    }
  }
  return null;
}
