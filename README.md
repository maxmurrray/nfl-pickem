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

Each week's page has a **Preview picks graphic** button. It renders a
shareable PNG server-side (`src/app/api/graphic/route.tsx`, via `next/og`)
and shows it at roughly phone-feed width first, so you judge the text at the
size followers actually see it, then download.

The board is three columns — the matchup on the left, then one column per
player — locked row-for-row. Each matchup card is split on a 12° diagonal
with the away team's colour on the left and the home team's on the right;
each pick card is filled with the picked team's colour. Downloads as
`week-{n}-picks.png`.

**Canvas.** 1080×1350 logical, exported at 2× → **2160×2700**. 4:5 is the
tallest portrait X shows uncropped in the timeline, so the layout never grows
past it: the canvas is fixed and *row height* is computed from the game count,
so a 16-game week and a 13-game bye week both fit without clipping. Extra
space on a short slate goes between the header and the rows, not at the
bottom. Square and Story exports are the same layout on a different canvas.

**Team colours** live in `src/lib/teams.ts` — a full 32-team table rather than
ESPN's own colour field. Four teams deviate from their official primary
because it's literal black and would vanish against the black background
(Raiders → silver, Steelers → gold, Jaguars → teal, Browns → orange). Teams
whose logo is too low-contrast on their own colour are flagged `whiteLogo`
and use ESPN's white `500-dark` variant. When a matchup pairs two teams with
near-identical colours (New England and Seattle are both `#002244`) the card
gets a dark hairline on the divider instead of fudging either brand colour.

**Logo drop shadows** are baked into the PNGs with `sharp` before the renderer
sees them: Satori silently ignores `filter: drop-shadow`, so the shadow is
made by blurring the logo's alpha channel, tinting it black and compositing it
underneath at an offset. That gives a shadow on the silhouette rather than a
box around the image. ESPN's logos also ship with a wide transparent margin,
so they're trimmed first and then sized **by height** — most NFL marks are
wider than they are tall, and fitting them into a square box collapses them to
half the intended size. Results are cached per (url, size) for the life of the
server instance. If `sharp` is unavailable the logos still render, just flat.

**Generated backdrop (optional).** The graphic is split into *art* and *data*.
Artwork behind the board can be generated with Nano Banana Pro (Gemini 3 Pro
Image) and dropped at `public/graphic/backdrop.png` — or `backdrop-x.png`,
`-square.png`, `-story.png` to vary by canvas. The renderer crops it to fill,
lays a scrim over it (`CONFIG.backdropScrim`) and draws the board on top. With
no file there, the board renders on flat black exactly as before.

The rows, logos, names and picks are **never** generated — they are always
composited from Supabase and ESPN. That boundary is the whole point: an image
model asked to redraw a 16-row board will approximate trademarked logos and
will sometimes put a player on the wrong team, and a picks graphic that is
subtly wrong is worse than a plain one. Art gets generated; facts get derived.

Two ways to make one:

- **No API key.** Generate it in the Higgsfield web UI (or anywhere else),
  download the PNG, save it to `public/graphic/`. Higgsfield publishes no
  developer API, so this is usually the path.
- **Scripted.** `node scripts/generate-backdrop.mjs --reference ref.png --size x`
  calls Gemini's `gemini-3-pro-image` directly at 4K with your reference image
  steering the style. Needs `GEMINI_API_KEY` in `.env.local`. Add `--dry-run`
  to see the request without spending anything.

Either way it runs **once** and the PNG is committed. The weekly export makes
no API call, costs nothing per week, and can't fail on a Sunday morning.

**Lock rule.** The endpoint returns 409 while any game that *hasn't kicked
off* is missing a pick, since rendering would leak one player's pick to the
other. Once a game is locked both picks are public anyway, so a past week
renders fine even if somebody never picked — those cells come out as empty
dark cards.

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
