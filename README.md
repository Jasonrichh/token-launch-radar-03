# Token Radar 4 — make.fun bounty entry (token-radar-01)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Jasonrichh/token-launch-radar-03/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Jasonrichh/token-launch-radar-03/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that finds pre-token protocols in a sealed DefiLlama snapshot, ranks them by
implied value, and shows how to farm each one — with every protocol priced from its
own nearest live-token comparables, and the engine tested out of sample before it
prices anything. Built for the make.fun bounty "Build the best token launch radar"
(deadline Mon 14 Dec 2026 18:00, $1,325 in prizes). A third, independent entry: the
first ("Token Radar", model radar-2) used median category multiples; the second
("Token Radar 3", model radar-3) fitted a global size curve; this one prices each
protocol locally, from its neighbours.

## The model (radar-4)

`implied = round(knn value x momentum x quality tilt)`

- **Comparables** — every live-token protocol (token trades, market cap above zero,
  not an exchange) is a candidate comparable. A protocol's features are log10(TVL),
  log10(age in days + 30) and clamped 7-day TVL change, each standardised by the live
  set's own mean and spread, plus a category dimension (0 same category, 1 different).
  Distance is weighted Euclidean: TVL 1.0, age 0.5, growth 0.5, category 1.0. The
  k = 12 nearest become the comparables.
- **k-NN value** — the inverse-distance-weighted geometric mean of the 12 comparables'
  market caps, weights 1 / (distance + 0.1). A close comparable counts far more than
  a distant one; the value is local, not a global law.
- **Momentum** — `1 + 0.30 x tanh(clamp(change_7d, -80, 400) / 60)`. The protocol's own
  7-day TVL move tilts the value; tanh keeps a +4,448% outlier from counting more
  than a strong +120% run. A bounded judgement term, stated as one.
- **Launch quality** — a 0-100 score from four observable facts, each 0-25: breadth
  (chains, capped at 8), age (older is more established, capped at 4 years), momentum
  (7-day change mapped from -50% to +100%), and scale (log10 TVL across the live
  set's own range). The tilt is `0.85 + 0.30 x score / 100`, so quality moves the
  value at most -15% to +15%. A bounded judgement term, stated as one.

## How the engine was tested

Both tests are computed from the snapshot at run time and printed on the dashboard.
They predict a live token's market cap from its comparables alone — no momentum, no
quality tilt — so they measure the engine itself:

- **Leave-one-out** — predict each live protocol from its 12 nearest neighbours among
  the other live protocols, and report the median absolute log10 error and the share
  of predictions within 2x of the truth.
- **Time split** — split the dated live protocols at their median listing date, use
  only the earlier half as the comparable pool, and predict the later half: the engine
  prices listings it has never seen. Same two numbers as leave-one-out.

The dashboard also reports, for the board itself, the median share of a row's
comparables that share its category and the median neighbour distance — so a reader
can see when a price leans on size and growth rather than on a like-for-like peer.

## The board and the farm plans

The board covers the whole 40-protocol watchlist plus every other rankable pre-token
protocol below the floor (226 rows on this snapshot), with an 8-step farm plan per row:
wallet setup, the category's main action, a second qualifying action, weekly cadence,
a points-page check, the hold, claim safety, and a netting step. Each step states its
cost and its time, and the last step nets the whole plan to the dollar: capital plus
gas over every transaction the plan asks for, the total out of pocket, and the
break-even share — the basis points of the implied value a launch would have to pay
the farmer for the farm to cover its own cost. The dashboard's Live token view runs
the same engine over the tokens that already trade, so a reader can see where the
comparables read high and where the market pays more than the neighbours suggest.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18+ (type stripping, standard library only). The program reads the snapshot,
prices the board from its comparables, writes `board.json`, `data.js`, copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun
library. Two runs produce byte-identical output.

## Layout

- `main.ts` — the program: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the radar-4 model: the comparables engine, its two tests, the implied
  values, the farm economics and the farm plans.
- `vendor/makefun-board.ts` — the make.fun dossier library, byte for byte from the kit.
- `dashboard/` — the static page (index.html, app.css, app.js), no network, no framework.
- `screenshots/` — the board, a protocol's detail view, and a filtered view, rendered
  in headless Chromium at 1440x900 from this dashboard's own files.
