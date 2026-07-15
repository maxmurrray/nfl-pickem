# Dad vs Rich · NFL Pick'em

A two-player NFL pick'em app. Every week, Dad and Rich each pick a
straight-up winner for every game. Picks lock at kickoff, get graded
automatically against ESPN's real scores, and a leaderboard tracks the
season-long battle.

## How it works

- **No accounts.** A toggle at the top picks who you are (Dad or Rich);
  the choice is remembered on the device via `localStorage`.
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
