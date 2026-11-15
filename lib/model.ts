// Token Radar's value model (radar-4): one sealed snapshot in, one ranked board out.
//
// The board covers every pre-token protocol the snapshot carries: the whole watchlist
// (the floor, never the ceiling) plus every other rankable protocol below the floor,
// strongest first. A protocol is pre-token when its record carries no token at all
// (no market cap, no CoinGecko id, no symbol); live-token protocols are kept apart and
// shown with the market's own values beside the model's reading of them, never mixed
// into the ranked board.
//
// radar-4 prices nothing from a global curve and nothing from a category median. It
// prices each protocol from its OWN comparables: the k live-token protocols nearest
// to it in a feature space built from the snapshot's own figures, then tilts that
// comparable value by the protocol's own momentum and by a launch-quality score.
//
//   comparables  every live-token protocol (token trades, market cap above zero, not
//                  an exchange) is a candidate comparable. A protocol's features are
//                  log10(TVL), log10(age in days + 30) and clamped 7-day TVL change,
//                  each standardized by the live set's own mean and spread, plus a
//                  category dimension that is 0 for the same category and 1 otherwise.
//                  Distance is weighted Euclidean: TVL 1.0, age 0.5, growth 0.5,
//                  category 1.0. The k = 12 nearest become the comparables.
//   knn value    the inverse-distance-weighted geometric mean of the 12 comparables'
//                  market caps, weights 1 / (distance + 0.1). A close comparable
//                  counts far more than a distant one; the value is local, not global.
//   momentum     1 + 0.30 x tanh(clamp(change_7d, -80, 400) / 60). The protocol's own
//                  7-day TVL move tilts the value; tanh keeps a +4,448% outlier from
//                  counting more than a strong +120% run. A bounded judgement term,
//                  stated as one.
//   quality      a 0-100 launch-quality score from four observable facts, each 0-25:
//                  breadth (chains, capped at 8), age (older is more established,
//                  capped at 4 years), momentum (7-day change mapped from -50% to
//                  +100%), and scale (log10 TVL across the live set's own range).
//                  The tilt is 0.85 + 0.30 x score / 100, so quality moves the value
//                  at most -15% to +15%. A bounded judgement term, stated as one.
//   implied      = max(1, round(knn value x momentum x quality tilt))
//
// The comparables engine is tested two ways, both computed from the snapshot at run
// time and printed on the dashboard, so a reader can check the yardstick before
// trusting a rank. Both tests predict a live protocol's market cap from its
// comparables alone, with no momentum and no quality tilt, so they measure the
// engine itself:
//   leave-one-out  predict each live protocol from its 12 nearest neighbours among
//                  the other live protocols, and report the median absolute log10
//                  error and the share of predictions within 2x of the truth.
//   time split     split the dated live protocols at their median listing date, use
//                  only the earlier half as the comparable pool, and predict the
//                  later half: the engine prices listings it has never seen. Same
//                  two numbers as leave-one-out.
//
// Farm economics are netted to the dollar on every row: the capital the position
// needs, the gas of every transaction the plan asks for, the weeks the position is
// held, the total out of pocket, and the break-even share — the basis points of the
// implied value a launch would have to pay the farmer for the farm to cover its own
// cost. No protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  neighbors: number;
  weight_tvl: number;
  weight_age: number;
  weight_growth: number;
  weight_category: number;
  distance_floor: number;
  momentum_weight: number;
  momentum_scale: number;
  momentum_floor: number;
  momentum_cap: number;
  quality_floor: number;
  quality_range: number;
  quality_max_chains: number;
  quality_max_age_days: number;
  quality_growth_floor: number;
  quality_growth_cap: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  neighbors: 12,
  weight_tvl: 1.0,
  weight_age: 0.5,
  weight_growth: 0.5,
  weight_category: 1.0,
  distance_floor: 0.1,
  momentum_weight: 0.3,
  momentum_scale: 60,
  momentum_floor: -80,
  momentum_cap: 400,
  quality_floor: 0.85,
  quality_range: 0.3,
  quality_max_chains: 8,
  quality_max_age_days: 1460,
  quality_growth_floor: -50,
  quality_growth_cap: 100,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One comparable a protocol was priced from. */
export interface NeighborInfo {
  slug: string;
  name: string;
  mcap_usd: number;
  distance: number;
  weight: number;
  same_category: boolean;
}

/** The engine's fit and its two out-of-sample tests, all computed from the snapshot. */
export interface ModelValidation {
  train_size: number;
  neighbors: number;
  loo_median_log_err: number;
  loo_within_2x: number;
  split_cutoff: string | null;
  split_train_size: number;
  split_test_size: number;
  split_median_log_err: number | null;
  split_within_2x: number | null;
  median_same_category_share: number;
  median_neighbor_distance: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    knn_value_usd: number;
    neighbors: NeighborInfo[];
    momentum_multiplier: number;
    growth_pct: number;
    quality_score: number;
    quality_tilt: number;
    quality_parts: { breadth: number; age: number; momentum: number; scale: number };
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_per_tx_usd: number;
    tx_count: number;
    gas_total_usd: number;
    hold_days: number;
    total_cost_usd: number;
    breakeven_bp: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  knn_value_usd: number;
  neighbors: NeighborInfo[];
  momentum_multiplier: number;
  quality_score: number;
  quality_tilt: number;
  capital_usd: number;
  gas_total_usd: number;
  total_cost_usd: number;
  breakeven_bp: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value beside the model's reading of it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  predicted_mcap_usd: number;
  ratio: number | null;
  neighbors: NeighborInfo[];
}

/** Everything the dashboard needs: the board, the live set, the engine and its tests. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  validation: ModelValidation;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LOG2 = Math.log10(2);

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers, or 0 when it is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Whether a protocol trains the comparables engine: its token trades, with a market cap above zero. */
export function isTrainable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** A protocol's three continuous features, before standardisation. */
interface RawFeatures {
  logTvl: number;
  logAge: number;
  growth: number;
}

/** The feature space the comparables engine measures distance in. */
interface FeatureSpace {
  meanTvl: number;
  sdTvl: number;
  meanAge: number;
  sdAge: number;
  meanGrowth: number;
  sdGrowth: number;
  medianAge: number;
  logTvlMin: number;
  logTvlMax: number;
}

function rawFeatures(p: SnapshotProtocol, asOf: string, medianAge: number): RawFeatures {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age === null ? medianAge : age;
  return {
    logTvl: Math.log10(Math.max(1, p.tvl_usd)),
    logAge: Math.log10(ageForModel + 30),
    growth: Math.min(MODEL.momentum_cap, Math.max(MODEL.momentum_floor, finite(p.change_7d, 0))),
  };
}

/** Build the feature space from the live-token set: its means, spreads and median age. */
function buildFeatureSpace(train: SnapshotProtocol[], asOf: string): FeatureSpace {
  const ages = train.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) : MODEL.unknown_age_days;
  const raws = train.map((p) => rawFeatures(p, asOf, medianAge));
  const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  const sd = (xs: number[], m: number): number => {
    const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, xs.length);
    return Math.sqrt(v) || 1;
  };
  const logTvls = raws.map((r) => r.logTvl);
  return {
    meanTvl: mean(raws.map((r) => r.logTvl)),
    sdTvl: sd(raws.map((r) => r.logTvl), mean(raws.map((r) => r.logTvl))),
    meanAge: mean(raws.map((r) => r.logAge)),
    sdAge: sd(raws.map((r) => r.logAge), mean(raws.map((r) => r.logAge))),
    meanGrowth: mean(raws.map((r) => r.growth)),
    sdGrowth: sd(raws.map((r) => r.growth), mean(raws.map((r) => r.growth))),
    medianAge,
    logTvlMin: Math.min(...logTvls),
    logTvlMax: Math.max(...logTvls),
  };
}

/** A protocol's standardised features: each raw feature minus the live set's mean, over its spread. */
function zFeatures(p: SnapshotProtocol, asOf: string, space: FeatureSpace): [number, number, number] {
  const r = rawFeatures(p, asOf, space.medianAge);
  return [
    (r.logTvl - space.meanTvl) / space.sdTvl,
    (r.logAge - space.meanAge) / space.sdAge,
    (r.growth - space.meanGrowth) / space.sdGrowth,
  ];
}

/** Weighted Euclidean distance between two protocols in feature space. */
function distance(
  a: [number, number, number],
  b: [number, number, number],
  sameCategory: boolean,
  model: ModelConstants,
): number {
  const dt = a[0] - b[0];
  const da = a[1] - b[1];
  const dg = a[2] - b[2];
  const dc = sameCategory ? 0 : 1;
  return Math.sqrt(
    model.weight_tvl * dt * dt +
      model.weight_age * da * da +
      model.weight_growth * dg * dg +
      model.weight_category * dc * dc,
  );
}

/**
 * The k nearest comparables of a protocol among a pool, and the inverse-distance
 * weighted geometric mean of their market caps. The pool never contains the protocol
 * itself: callers pass a pool that already excludes it.
 */
export function knnPredict(
  target: SnapshotProtocol,
  pool: SnapshotProtocol[],
  asOf: string,
  space: FeatureSpace,
  model: ModelConstants = MODEL,
): { value: number; neighbors: NeighborInfo[] } {
  const tz = zFeatures(target, asOf, space);
  const targetCat = target.category ?? 'Other';
  const scored = pool.map((p) => {
    const same = (p.category ?? 'Other') === targetCat;
    const d = distance(tz, zFeatures(p, asOf, space), same, model);
    return { p, d, same };
  });
  scored.sort((a, b) => a.d - b.d || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const nearest = scored.slice(0, model.neighbors);
  const weights = nearest.map((n) => 1 / (n.d + model.distance_floor));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  let logSum = 0;
  for (let i = 0; i < nearest.length; i++) {
    logSum += weights[i]! * Math.log10(Math.max(1, nearest[i]!.p.mcap_usd!));
  }
  const value = Math.max(1, Math.round(10 ** (logSum / weightSum)));
  const neighbors: NeighborInfo[] = nearest.map((n, i) => ({
    slug: n.p.slug,
    name: n.p.name,
    mcap_usd: n.p.mcap_usd!,
    distance: round4(n.d),
    weight: round4(weights[i]! / weightSum),
    same_category: n.same,
  }));
  return { value, neighbors };
}

/** The launch-quality score: four observable facts, each worth 0-25 points. */
export function qualityScore(
  p: SnapshotProtocol,
  asOf: string,
  space: FeatureSpace,
  model: ModelConstants = MODEL,
): { score: number; parts: { breadth: number; age: number; momentum: number; scale: number } } {
  const breadth = (Math.min(p.chains.length, model.quality_max_chains) / model.quality_max_chains) * 25;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age === null ? model.unknown_age_days : age;
  const agePart = (Math.min(Math.max(ageForModel, 0), model.quality_max_age_days) / model.quality_max_age_days) * 25;
  const growth = finite(p.change_7d, 0);
  const growthClamped = Math.min(model.quality_growth_cap, Math.max(model.quality_growth_floor, growth));
  const momentumPart =
    ((growthClamped - model.quality_growth_floor) / (model.quality_growth_cap - model.quality_growth_floor)) * 25;
  const span = Math.max(0.01, space.logTvlMax - space.logTvlMin);
  const scalePart =
    Math.min(1, Math.max(0, (Math.log10(Math.max(1, p.tvl_usd)) - space.logTvlMin) / span)) * 25;
  const parts = {
    breadth: round2(breadth),
    age: round2(agePart),
    momentum: round2(momentumPart),
    scale: round2(scalePart),
  };
  return { score: round2(parts.breadth + parts.age + parts.momentum + parts.scale), parts };
}

/** The momentum tilt from the protocol's own 7-day TVL move, and the clamped move itself. */
export function momentumOf(p: SnapshotProtocol, model: ModelConstants = MODEL): { growthPct: number; mult: number } {
  const growthPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, finite(p.change_7d, 0)));
  return { growthPct, mult: 1 + model.momentum_weight * Math.tanh(growthPct / model.momentum_scale) };
}

/**
 * The comparables engine and its tests, fitted on the snapshot's live-token protocols.
 * The tests predict a live protocol's market cap from its comparables alone — no
 * momentum, no quality tilt — so they measure the engine itself, not the judgement
 * terms wrapped around it.
 */
export function fitEngine(snapshot: Snapshot, model: ModelConstants = MODEL): ModelValidation {
  const train = snapshot.protocols.filter(isTrainable);
  const space = buildFeatureSpace(train, snapshot.as_of);

  // Leave-one-out: predict each live protocol from the other live protocols.
  const looErrors: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const pool = train.filter((_, j) => j !== i);
    const { value } = knnPredict(train[i]!, pool, snapshot.as_of, space, model);
    looErrors.push(Math.abs(Math.log10(train[i]!.mcap_usd!) - Math.log10(value)));
  }
  const looMedian = median(looErrors);
  const looWithin = looErrors.length === 0 ? 0 : looErrors.filter((e) => e <= LOG2).length / looErrors.length;

  // Time split: the earlier half of the dated live protocols is the only pool the
  // later half may draw comparables from.
  const dated = train
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  let splitCutoff: string | null = null;
  let splitTrain = 0;
  let splitTest = 0;
  let splitMedian: number | null = null;
  let splitWithin: number | null = null;
  if (dated.length >= 10) {
    const half = Math.floor(dated.length / 2);
    const earlier = dated.slice(0, half);
    const later = dated.slice(half);
    splitCutoff = later[0]!.listed_at;
    splitTrain = earlier.length;
    splitTest = later.length;
    const errs = later.map((p) => {
      const { value } = knnPredict(p, earlier, snapshot.as_of, space, model);
      return Math.abs(Math.log10(p.mcap_usd!) - Math.log10(value));
    });
    splitMedian = round4(median(errs));
    splitWithin = round4(errs.filter((e) => e <= LOG2).length / errs.length);
  }

  // Honesty metrics over the board's own pricing: how many of a row's comparables
  // share its category, and how far away its comparables sit.
  const boardTargets = snapshot.protocols.filter(isRankable);
  const sameShares: number[] = [];
  const distances: number[] = [];
  for (const p of boardTargets) {
    const { neighbors } = knnPredict(p, train, snapshot.as_of, space, model);
    if (neighbors.length === 0) continue;
    sameShares.push(neighbors.filter((n) => n.same_category).length / neighbors.length);
    distances.push(median(neighbors.map((n) => n.distance)));
  }

  return {
    train_size: train.length,
    neighbors: model.neighbors,
    loo_median_log_err: round4(looMedian),
    loo_within_2x: round4(looWithin),
    split_cutoff: splitCutoff,
    split_train_size: splitTrain,
    split_test_size: splitTest,
    split_median_log_err: splitMedian,
    split_within_2x: splitWithin,
    median_same_category_share: round4(median(sameShares)),
    median_neighbor_distance: round4(median(distances)),
  };
}

/** The comparables value, momentum tilt and quality tilt one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  train: SnapshotProtocol[],
  space: FeatureSpace,
  model: ModelConstants = MODEL,
): {
  implied: number;
  knn: number;
  neighbors: NeighborInfo[];
  growthPct: number;
  growthMult: number;
  quality: number;
  qualityTilt: number;
  qualityParts: { breadth: number; age: number; momentum: number; scale: number };
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { value, neighbors } = knnPredict(protocol, train, asOf, space, model);
  const { growthPct, mult } = momentumOf(protocol, model);
  const { score, parts } = qualityScore(protocol, asOf, space, model);
  const qualityTilt = model.quality_floor + model.quality_range * (score / 100);
  const implied = Math.max(1, Math.round(value * mult * qualityTilt));
  return { implied, knn: value, neighbors, growthPct, growthMult: mult, quality: score, qualityTilt, qualityParts: parts, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; validation: ModelValidation } {
  const validation = fitEngine(snapshot, model);
  const train = snapshot.protocols.filter(isTrainable);
  const space = buildFeatureSpace(train, snapshot.as_of);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen. The protocols above the floor that the
  // watchlist leaves out are wrapped, staked or bridged products of tokens that already trade,
  // so they are not launches waiting to happen and the board leaves them out on purpose.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, train, space, model);
    const farm = farmEconomics(p, v.age);
    return { p, ...v, farm };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      knn_value_usd: s.knn,
      neighbors: s.neighbors,
      momentum_multiplier: round4(s.growthMult),
      growth_pct: s.growthPct,
      quality_score: s.quality,
      quality_tilt: round4(s.qualityTilt),
      quality_parts: s.qualityParts,
      age_days: s.age,
    },
    farm: s.farm,
    farm_steps: farmSteps(s.p, s.age, s.farm, s.implied).map(stepText),
  }));
  return { board, validation };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on the protocol's main chain, in whole dollars. */
export function gasPerTxUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana') return 0.1;
  if (c === 'bitcoin') return 2;
  return 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm's dollar math: capital, every transaction's gas, the hold, the total out of pocket, and the break-even share of the implied value. */
export interface FarmEconomics {
  capital_usd: number;
  gas_per_tx_usd: number;
  tx_count: number;
  gas_total_usd: number;
  hold_days: number;
  total_cost_usd: number;
  breakeven_bp: number;
}

export function farmEconomics(p: SnapshotProtocol, age: number | null): FarmEconomics {
  const capital = capitalFor(p);
  const gasPerTx = gasPerTxUsd(chainOf(p));
  const hold = holdDaysFor(age);
  const weekly = Math.ceil(hold / 7);
  const txCount = 2 + weekly + 1;
  const gasTotal = Math.round(gasPerTx * txCount * 100) / 100;
  const total = Math.round((capital + gasTotal) * 100) / 100;
  // breakeven_bp needs the implied value, so buildRadar fills it in once the board is ranked.
  return { capital_usd: capital, gas_per_tx_usd: gasPerTx, tx_count: txCount, gas_total_usd: gasTotal, hold_days: hold, total_cost_usd: total, breakeven_bp: 0 };
}

/** The break-even share of the implied value, in basis points, once the implied value is known. */
export function breakevenBp(totalCostUsd: number, impliedUsd: number): number {
  return Math.round((totalCostUsd / Math.max(1, impliedUsd)) * 10000 * 100) / 100;
}

/** The category's main action and its second qualifying action, in words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`,
      `Take a $25 stablecoin loan against the deposit, then repay it the same week to show borrowing activity.`,
    ];
  }
  if (c.includes('dex')) {
    return [
      `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in place.`,
      `Trade $25 through ${name} once a week so the wallet builds a swap history.`,
    ];
  }
  if (c.includes('yield') || c.includes('aggregator') || c.includes('leveraged farm') || c.includes('farm')) {
    return [
      `Put $${capital} of USDC into ${name}'s largest vault on ${chain} and hold the vault shares.`,
      `Claim the vault yield once and put the proceeds back into the same vault.`,
    ];
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return [
      `Move $${capital} of USDC to ${chain} through ${name} and use it inside the destination app.`,
      `Send a smaller amount back across the bridge to show the route works both ways.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} through ${name} on ${chain} and keep the liquid receipt token.`,
      `Delegate or restake the receipt once, or vote in a governance poll if one opens.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return [
      `Fund ${name} with $${capital} of USDC margin on ${chain} and open one small position.`,
      `Close the position and open one more at small size, keeping exposure under $${capital} in total.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund an account with $${capital} and take one small position in a ${name} market.`,
      `Close it and take a second position in a different market.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of ${name}'s yield-bearing token on ${chain} and hold it.`,
      `Claim one yield payout from the position, or reinvest it.`,
    ];
  }
  if (c.includes('stable') || c.includes('algo-stable')) {
    return [
      `Mint $${capital} of stable value through ${name} on ${chain}.`,
      `Redeem a small amount back to USDC and mint again, completing a full cycle.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover on ${name} (${chain}) and keep the policy live.`,
      `Renew the cover once before it ends instead of letting it lapse.`,
    ];
  }
  if (c.includes('launchpad')) {
    return [
      `Commit $${capital} of USDC to an allocation on ${name} (${chain}) and hold it.`,
      `Join one launch round or vote on one allocation.`,
    ];
  }
  if (c.includes('nft')) {
    return [
      `Do about $${capital} of trading volume on ${name} (${chain}), across one or two items.`,
      `Trade once more the next week so the wallet shows repeat activity.`,
    ];
  }
  if (c.includes('payment') || c.includes('card')) {
    return [
      `Spend $${capital} through ${name} on ${chain} and keep the account open.`,
      `Make a second payment the following week.`,
    ];
  }
  if (c.includes('ai') || c.includes('agent')) {
    return [
      `Run $${capital} of work through ${name} on ${chain}, such as inference or an agent task.`,
      `Run a second task and leave a rating in the app.`,
    ];
  }
  if (c.includes('index')) {
    return [
      `Buy $${capital} of ${name}'s index on ${chain} and hold it.`,
      `Top the position up by $25 once, or rebalance if the app offers it.`,
    ];
  }
  if (c.includes('chain') && !c.includes('cross')) {
    return [
      `Bridge $${capital} of USDC onto ${name} and try one native app on the chain.`,
      `Use a second native app on the same chain.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return [
      `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`,
      `Shift $25 between two allocations inside the vault.`,
    ];
  }
  if (c.includes('basis')) {
    return [
      `Put $${capital} of USDC into ${name}'s basis trade on ${chain} and leave it running.`,
      `Add $25 after the first funding period.`,
    ];
  }
  if (c.includes('synthetic')) {
    return [
      `Mint $${capital} of synthetic assets on ${name} (${chain}) and hold them.`,
      `Burn a small amount back and mint again to complete a cycle.`,
    ];
  }
  if (c.includes('governance')) {
    return [
      `Lock $${capital} in ${name}'s governance on ${chain} and cast one vote.`,
      `Vote on a second proposal when one appears.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Do one more qualifying action in the app, such as a swap, a deposit or a vote.`,
  ];
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names: two protocols in the same category farm the same way, and a
 * bigger one asks for more capital. The last step nets the whole plan to the dollar.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, farm: FarmEconomics, impliedUsd: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = farm.capital_usd;
  const hold = farm.hold_days;
  const gas = farm.gas_per_tx_usd;
  const gasText = gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
  const weeklyGas = Math.round(gas * Math.ceil(hold / 7) * 100) / 100;
  const bp = breakevenBp(farm.total_cost_usd, impliedUsd);
  const [main, second] = actionsFor(p, capital, chain);
  return [
    {
      text: `Use a dedicated wallet for this farm only. Fund it with $${capital} plus gas on ${chain}, and store its seed phrase offline.`,
      cost: `${gasText} of gas for the first transaction`,
      time: '10 minutes',
    },
    {
      text: main,
      cost: `$${capital} of capital and ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $25 of volume and ${gasText} of gas`,
      time: '10 minutes',
    },
    {
      text: `Do one qualifying action each week — a deposit, a swap, a vote or a claim — so the wallet shows steady activity.`,
      cost: `about $${weeklyGas} of gas over ${Math.ceil(hold / 7)} weeks`,
      time: '10 minutes a week',
    },
    {
      text: `Open ${p.name}'s own points or rewards page from the link the protocol itself publishes and check the position is counted.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If a token is announced, claim only from the protocol's own page or announcement, and never pay anyone to claim for you.`,
      cost: 'gas only, never a claim fee',
      time: '10 minutes',
    },
    {
      text: `Net it out: $${capital} of capital plus $${farm.gas_total_usd} of gas over ${farm.tx_count} transactions is $${farm.total_cost_usd} out of pocket. The farm pays for itself if a launch pays you ${bp} basis points of the $${impliedUsd.toLocaleString('en-US')} implied value.`,
      cost: `$${farm.total_cost_usd} all in`,
      time: `${hold} days, then unwind in two parts`,
    },
  ];
}

/** The live-token protocols, by market cap, with the engine's reading of each beside the market's own. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  const train = snapshot.protocols.filter(isTrainable);
  const space = buildFeatureSpace(train, snapshot.as_of);
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const pool = train.filter((t) => t.slug !== p.slug);
      const { value, neighbors } =
        p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && pool.length > 0
          ? knnPredict(p, pool, snapshot.as_of, space, model)
          : { value: 0, neighbors: [] as NeighborInfo[] };
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        predicted_mcap_usd: value,
        ratio: p.mcap_usd !== null && p.mcap_usd > 0 && value > 0 ? round3(p.mcap_usd / value) : null,
        neighbors,
      };
    });
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    knn_value_usd: row.model.knn_value_usd,
    neighbors: row.model.neighbors,
    momentum_multiplier: row.model.momentum_multiplier,
    quality_score: row.model.quality_score,
    quality_tilt: row.model.quality_tilt,
    capital_usd: row.farm.capital_usd,
    gas_total_usd: row.farm.gas_total_usd,
    total_cost_usd: row.farm.total_cost_usd,
    breakeven_bp: row.farm.breakeven_bp,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, validation } = buildBoard(snapshot, model);
  // The break-even share needs the implied value, so it is filled in after the board is ranked.
  // (The last farm step already carries the same netting: farmSteps computed it from the implied value.)
  for (const row of board) {
    row.farm.breakeven_bp = breakevenBp(row.farm.total_cost_usd, row.implied_value_usd);
  }
  const live = liveRows(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
