# Bruce vs Rich · NFL Pick'em

A two-player NFL pick'em app. Every week, Bruce and Rich each pick a
straight-up winner for every game. Picks lock at kickoff, get graded
automatically against ESPN's real scores, and a leaderboard tracks the
season-long battle.

## How it works

- **No accounts.** A toggle at the top picks who you are (Bruce or
  Rich); the choice is remembered on the device via `localStorage`.
  (Bruce is stored as the player id `dad` in the database.)
- **Schedule + scores** come from ESPN's public scoreboard API, fetched
  server-side and cached for 60 seconds. The "current week" comes from
  ESPN's own week metadata — nothing is hardcoded.
- **Picks** are stored in a single Supabase `picks` table
  (see [supabase/schema.sql](supabase/schema.sql)). Results are **not**
  stored: grading happens on the fly by joining stored picks against
  ESPN's live/final data on every page load, so there are no cron jobs.
- **Lock rules** are enforced server-side in
  [src/app/api/picks/route.ts](src/app/api/picks/route.ts): a pick for
  any game whose kickoff has passed is rejected with a 409. Before
  kickoff, the API also hides the opponent's pick so nobody can copy;
  after kickoff both picks are visible.
- **Scoring:** correct pick = 1 point. An actual tie in the game counts
  as correct for both players. No pick by kickoff = automatic miss.
- **Regular season only** for now (`seasontype=2`). Postseason support
  means threading a `seasonType` through `src/lib/espn.ts` and the picks
  API/table.

## Picks graphic

Once **both** players have picked every game in a week, a
"Download picks graphic" button appears on that week's page. It renders
a shareable PNG server-side (`src/app/api/graphic/route.tsx`, via
`next/og`) in a broadcast-style board: team-color banner rectangles
with oversized logos, an AT badge on each matchup, and all-time records
under each name. Sizes: Twitter 4:5 (1600×2000), square (1080×1080),
and vertical story (1080×1920). The endpoint refuses to render until
both players are done, since the graphic reveals all picks. A few teams
use ESPN's white "-dark" logo variant so the logo doesn't vanish
against its own team color (see `WHITE_LOGO_TEAMS`).

## Starting over

Each player can wipe their own division predictions with the **Start over**
button under the save row on `/divisions`. It clears both conferences for that
player only, behind a confirm dialog, and leaves weekly picks alone (different
table). Like saving, it is refused once the season kicks off.

The site runs on the Supabase anon key, which has select/insert/update but
deliberately **no delete** — so nobody can wipe a season by pointing a script
at the public key. Deleting therefore uses the `service_role` key, read
server-side in `deletePredictions()` and never sent to the browser. Without
`SUPABASE_SERVICE_ROLE_KEY` set, the endpoint returns a clear 503 instead of
silently doing nothing (a delete the anon key isn't allowed to make still comes
back as a cheerful success, so the store re-checks rather than trusting it).

From a terminal, `scripts/reset-player.mjs` does the same job and can also
clear weekly picks, backing up to `.data/` first:

```
node scripts/reset-player.mjs rich            # records + picks
node scripts/reset-player.mjs rich --records  # records only
node scripts/reset-player.mjs rich --dry-run  # count, delete nothing
```

Note the two tables use different ids for the same person: `picks` stores Bruce
as `dad`, `division_predictions` stores him as `bruce`. Clearing one and not
the other is why a "reset" board can still come up filled in.

## Pages

- `/` — this week's games: tap a team to pick, live scores, lock states,
  running Dad-vs-Rich weekly score.
- `/leaderboard` — season totals, week-by-week table, current leader.
- `/week/[n]` — browse any week (past = results, future = pickable).

## Environment variables

| Variable            | Where to find it                                  |
| ------------------- | ------------------------------------------------- |
| `SUPABASE_URL`      | Supabase dashboard → Project Settings → API → URL |
| `SUPABASE_ANON_KEY` | Same page → `anon` `public` key                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → `service_role` `secret`. Only needed for Start over / the reset script. Server-side only. |

Locally these go in `.env.local` (copy `.env.local.example`). On Vercel,
add them under Project → Settings → Environment Variables.

If they're missing, the app still runs but stores picks in server memory
(they vanish on restart) and shows a warning banner.

## Setup from scratch

1. **Supabase:** create a free project at [supabase.com](https://supabase.com),
   open the SQL Editor, and run the contents of `supabase/schema.sql`.
   Copy the project URL and anon key.
2. **Local dev:** `cp .env.local.example .env.local`, fill in the two
   values, then `npm install && npm run dev`.
3. **Deploy:** push this repo to GitHub, import it on
   [vercel.com](https://vercel.com), add the two env vars, deploy.
