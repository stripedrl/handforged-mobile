/**
 * Slay-the-Spire-style act map generator, v2. Pure logic, injectable RNG.
 *
 * v2 (JC, 2026-07-29): 10 floors + boss (~7-8 fights incl. elites per route),
 * and LEAP EDGES — occasional arcs that skip a floor entirely, so some routes
 * are shorter but tend to run through elites/events: fewer rooms, richer rooms.
 * Layout intent: starts gather near the center, everything funnels to a
 * centered boss; the scene spreads each floor organically (no strict columns).
 *
 * Node: { id, row, col, type, mythic, forged, eliteIdx, next: [ids], leaps: [ids], jx, jy, visited }
 * Map:  { rows, cols, nodes, starts, bossId, currentId, taken, eliteBag }
 */

// difficulty.js is a LEAF (it imports nothing at all), so this edge can never
// close a cycle — which is what lets the FORGED gate live beside the roll it
// gates instead of being re-derived by every caller.
import { difficultyIndex } from './difficulty.js';

export const MAP_ROWS = 10;   // floors before the boss
export const MAP_COLS = 7;
const WALKS = 5;
const LEAP_CHANCE = 0.16;     // per eligible node
const MAX_LEAPS = 3;

// ---------------------------------------------------------------------------
// THE BOARD'S GRAMMAR (JC, 2026-08-11)
// ---------------------------------------------------------------------------
/**
 * "If I have to path through an element, I shouldn't be able to skip it since a
 * different element has a path that stretches right over it and above it."
 *
 * That is the whole rule the map is read by, and it had never been written
 * down: A TRAIL THAT TOUCHES A ROOM IS A TRAIL THAT GOES THROUGH IT. Every
 * other promise the board makes — that a route is a route, that a leap is a
 * shortcut PAST something — is parasitic on it, and a single arc drawn over a
 * room it does not connect to breaks all of them at once.
 *
 * Enforcing it means the GENERATOR has to know where its own nodes will be
 * DRAWN, which it previously did not: the layout lived in MapScene (and a
 * second copy of it in ui/mapPeek). A leap was created purely from row/column
 * adjacency and only later discovered, on screen, to be arcing through the
 * middle of the floor it skipped. Measured over 8,000 shipped boards: 60.0% of
 * leap arcs came within 90px of a room they did not connect to, 81.6% of boards
 * had at least one, and the worst passed through a node's exact centre.
 *
 * So the layout moved DOWN here, the generator computes it, and clearance is
 * now a generation invariant rather than a drawing accident. MapScene and
 * mapPeek both read `mapLayout` and both draw leaps on the arc `leapBulge`
 * picked, so the board that is checked is the board that is painted.
 */

/** Vertical pitch between floors, in board units. */
export const ROW_GAP = 150;
/** The horizontal band the rooms occupy (clear of the painted frame). */
export const NODE_BAND = 1500;
/** ...and the widest a sparse floor is allowed to spread. */
export const MAX_COL_GAP = 430;
/** How far a room may wander off its lattice point, so no floor reads as a row of pegs. */
export const JITTER_X = 46;
export const JITTER_Y = 30;

/**
 * NO TRAIL COMES WITHIN THIS OF A ROOM IT DOES NOT CONNECT TO.
 *
 * 90 board units, and it is sized off the biggest thing that stands on a node:
 * a FORGED elite draws at r=68 with its icon scaled to 2.2r, so its painted
 * half-extent is ~75px. 90 clears that, plus the ±3px hand-drawn wobble
 * MapScene gives each dot, with a few pixels to spare — which is the difference
 * between "the trail passes near that room" and "the trail is touching it".
 */
export const NODE_CLEAR_RADIUS = 90;
/**
 * ...and no two rooms are drawn closer than this, centre to centre. The shipped
 * board bottomed out at 91.2 (two floors 150 apart, both nodes jittered the full
 * 30 toward each other); the jitter is now tidied until this holds.
 */
export const NODE_MIN_SPACING = 94;

/**
 * THE ARCS A LEAP IS ALLOWED TO TAKE, smallest first.
 *
 * A quadratic Bezier's apex sits HALF the control offset off the chord, so the
 * shipped ±74 bulge bowed a leap by 37px — against a 150px floor pitch, that is
 * a straight line with a kink in it, and it is why leaps read as passing
 * THROUGH the floor they skip. The smallest rung here is 150 (a 75px bow), so
 * every leap visibly leaves the chord; the ladder climbs to 300 (150px) for the
 * arcs that have to get around a busy floor.
 */
export const LEAP_BULGES = [150, 195, 245, 300];
/**
 * Clearance at which a leap stops shopping for a wider arc. Above this the arc
 * is unmistakably clear of the floor it skips, so taking a bigger swing buys
 * nothing but a wilder line.
 */
export const LEAP_CLEAR_GOOD = 140;

/** How many times the generator may re-roll a crowded board's jitter. */
const JITTER_PASSES = 14;

/**
 * WHERE EVERY ROOM ON THIS BOARD IS DRAWN, in board space (x centred on 0, y
 * growing downward with row 0 at the bottom). MapScene adds GAME_W/2; mapPeek
 * scales the whole thing into a frame. Pure arithmetic over the map, so the
 * generator, both boards and the tests all read one answer.
 */
export function mapLayout(map) {
  return layoutOf(map.nodes, map.rows ?? MAP_ROWS, map.bossId ?? 'boss');
}

function layoutOf(nodes, rows, bossId) {
  const contentH = 300 + rows * ROW_GAP + 300;
  const pos = {};
  const all = Object.values(nodes);
  for (let row = 0; row < rows; row++) {
    const rowNodes = all.filter(n => n.row === row && n.id !== bossId).sort((a, b) => a.col - b.col);
    const n = rowNodes.length;
    const gap = Math.min(MAX_COL_GAP, NODE_BAND / Math.max(n, 2));
    rowNodes.forEach((node, i) => {
      pos[node.id] = {
        x: (i - (n - 1) / 2) * gap + (node.jx ?? 0),
        y: contentH - 280 - row * ROW_GAP + (node.jy ?? 0),
      };
    });
  }
  if (nodes[bossId]) pos[bossId] = { x: 0, y: contentH - 280 - rows * ROW_GAP - 78 };
  return { pos, contentH };
}

/**
 * The polyline a trail is actually drawn along: a straight chord when `bulge` is
 * 0, and otherwise the quadratic Bezier whose control point is pushed `bulge`
 * sideways off the chord's midpoint — exactly the curve both boards paint their
 * dots on. Endpoints included, so the caller can measure the whole thing.
 */
export function edgePoints(a, b, bulge = 0, steps = 28) {
  if (!bulge) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  const out = [];
  for (let s = 0; s <= steps; s++) out.push(edgeAt(a, b, bulge, s / steps));
  return out;
}

/** One point on that same curve — what the boards walk to lay their dots down. */
export function edgeAt(a, b, bulge, t) {
  const mx = (a.x + b.x) / 2 + bulge, my = (a.y + b.y) / 2;
  const omt = 1 - t;
  return {
    x: omt * omt * a.x + 2 * omt * t * mx + t * t * b.x,
    y: omt * omt * a.y + 2 * omt * t * my + t * t * b.y,
  };
}

/** How long that polyline is — what the dot spacing is divided into. */
export function edgeLength(points) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return len;
}

function distToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  let t = L ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** The closest any point on `points` comes to any node in `pos` bar the two it joins. */
export function pathClearance(points, pos, skip) {
  let worst = Infinity, node = null;
  for (const key of Object.keys(pos)) {
    if (skip.includes(key)) continue;
    const p = pos[key];
    let d = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const seg = distToSegment(p, points[i], points[i + 1]);
      if (seg < d) d = seg;
    }
    if (d < worst) { worst = d; node = key; }
  }
  return { clearance: worst, node };
}

/**
 * The trail from `aId` to `bId` on the given arc, and the nearest FOREIGN room
 * it passes. `clearance` below NODE_CLEAR_RADIUS is a trail that is touching a
 * room it does not connect to — which is the one thing the board may never do.
 */
export function edgeClearance(pos, aId, bId, bulge = 0) {
  const points = edgePoints(pos[aId], pos[bId], bulge);
  return { ...pathClearance(points, pos, [aId, bId]), points, bulge };
}

/**
 * THE ARC A LEAP TAKES: the smallest bow that gets visibly clear of everything
 * it flies over. Walks the ladder from the tightest arc up, tries BOTH sides of
 * the chord at each rung and keeps the roomier one, and stops the moment a rung
 * reads unmistakably clear (LEAP_CLEAR_GOOD).
 *
 * Returns the best it found either way — the caller decides whether that is good
 * enough. The GENERATOR refuses to create a leap whose best arc still fails
 * NODE_CLEAR_RADIUS; the two boards call this same function at DRAW time, so a
 * board built by an older build (whose leaps were never vetted) is still painted
 * on the roomiest arc available rather than straight through a room.
 *
 * Deterministic: no rng, ties resolved toward the left-hand arc, so the picture
 * cannot change between a scene restart and a save/resume.
 */
export function leapBulge(pos, aId, bId) {
  let best = null;
  for (const mag of LEAP_BULGES) {
    let rung = null;
    for (const sign of [-1, 1]) {
      const r = edgeClearance(pos, aId, bId, mag * sign);
      if (!rung || r.clearance > rung.clearance) rung = r;
    }
    if (!best || rung.clearance > best.clearance) best = rung;
    if (rung.clearance >= LEAP_CLEAR_GOOD) return rung;
  }
  return best;
}

/** Do two drawn segments cross, other than by sharing an end? */
function segmentsCross(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

/**
 * THE BOARD, MEASURED — one answer for the tests, the statistical sweep and the
 * live `__hf.mapGeometry()` hook alike, so a driver and a unit test can never
 * disagree about what "this trail is touching that room" means.
 *
 * `pos` defaults to the pure board layout; MapScene passes its own screen-space
 * copy (the same points, translated by GAME_W/2 — every number below is
 * translation-invariant).
 *
 *   violations  every trail that comes within NODE_CLEAR_RADIUS of a room it
 *               does not connect to. ASSERT [].
 *   crossings   every pair of NORMAL trails whose drawn lines intersect.
 *               ASSERT []. Leaps are exempt by definition: an arc that skips a
 *               floor has to get past that floor's trails, and it does it in
 *               plain sight, wide of every room on the way.
 */
export function mapPathAudit(map, pos = null) {
  const p = pos ?? mapLayout(map).pos;
  const nodes = Object.values(map.nodes);
  const edges = [];
  for (const n of nodes) {
    for (const to of n.next) {
      if (!p[to]) continue;
      const leap = !!n.leaps?.includes(to);
      const arc = leap ? leapBulge(p, n.id, to) : edgeClearance(p, n.id, to, 0);
      edges.push({
        from: n.id, to, leap, bulge: arc.bulge,
        points: arc.points, clearance: arc.clearance, worstNode: arc.node,
      });
    }
  }
  const violations = edges.filter(e => e.clearance < NODE_CLEAR_RADIUS)
    .map(e => ({ from: e.from, to: e.to, leap: e.leap, clearance: e.clearance, worstNode: e.worstNode }));

  const straight = edges.filter(e => !e.leap);
  const crossings = [];
  for (let i = 0; i < straight.length; i++) {
    for (let j = i + 1; j < straight.length; j++) {
      const A = straight[i], B = straight[j];
      if (A.from === B.from || A.to === B.to || A.from === B.to || A.to === B.from) continue;
      if (segmentsCross(p[A.from], p[A.to], p[B.from], p[B.to])) {
        crossings.push({ a: [A.from, A.to], b: [B.from, B.to] });
      }
    }
  }

  let minNodeSpacing = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = p[nodes[i].id], b = p[nodes[j].id];
      if (!a || !b) continue;
      minNodeSpacing = Math.min(minNodeSpacing, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return {
    clearRadius: NODE_CLEAR_RADIUS, minSpacing: NODE_MIN_SPACING,
    nodes: nodes.map(n => ({
      id: n.id, row: n.row, col: n.col, type: n.type,
      forged: !!n.forged, mythic: !!n.mythic, x: p[n.id]?.x ?? null, y: p[n.id]?.y ?? null,
    })),
    edges, violations, crossings, minNodeSpacing,
    minClearance: edges.reduce((m, e) => Math.min(m, e.clearance), Infinity),
    leaps: edges.filter(e => e.leap).length,
  };
}

/**
 * TIDY THE JITTER UNTIL THE BOARD READS (JC, 2026-08-11).
 *
 * Every room wanders off its lattice point so no floor looks like a row of pegs,
 * and it is that wander — not the topology — that pushes two rooms to 91px apart
 * or slides a room under a straight trail it has nothing to do with (1.28% of
 * shipped trails, on 26.6% of shipped boards).
 *
 * So the FIRST move is on the jitter and not on the board: re-roll the
 * offenders and look again. Topology, room types, shop guarantees and every
 * pacing number are untouched by construction, which is why this is not a
 * regenerate — a rejection sampler on the BOARD would quietly bias the mix the
 * pacing pass spent a week tuning.
 *
 * SOME BOARDS CANNOT BE TIDIED, and the reason is worth writing down because it
 * is the OTHER half of what JC saw. Every floor is spread from ITS OWN centre by
 * row-local INDEX, not by column — that is the deliberate "no strict columns"
 * look — so a walk that drifts one column can land two INDEX slots over when the
 * two floors hold different rooms, and the trail then stretches clean across the
 * floor past a room it does not connect to. That is a topology problem wearing a
 * layout costume, and no amount of jitter fixes ~0.4% of them. Those boards are
 * refused (this returns null) and generateMap rolls another, exactly the way it
 * already does for the merchant contract.
 */
function tidyJitter(nodes, rows, bossId, rng) {
  const list = Object.values(nodes);
  for (let pass = 0; pass < JITTER_PASSES; pass++) {
    const { pos } = layoutOf(nodes, rows, bossId);
    const bad = new Set();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = pos[list[i].id], b = pos[list[j].id];
        if (Math.hypot(a.x - b.x, a.y - b.y) < NODE_MIN_SPACING) { bad.add(list[i].id); bad.add(list[j].id); }
      }
    }
    for (const n of list) {
      for (const nx of n.next) {
        const r = edgeClearance(pos, n.id, nx, 0);
        if (r.clearance < NODE_CLEAR_RADIUS) { bad.add(n.id); bad.add(nx); if (r.node) bad.add(r.node); }
      }
    }
    bad.delete(bossId);          // pinned dead centre; it has no jitter to re-roll
    if (!bad.size) return pos;
    // FULL amplitude every pass. An early cut of this shrank the re-roll toward
    // the bare lattice as the passes ran out, on the theory that a flat board is
    // provably clear — and it is exactly backwards: the lattice is where the
    // index-skip above is at its WORST (73.9px), so shrinking walked the
    // stubborn boards INTO the failure it was trying to escape.
    for (const key of bad) {
      nodes[key].jx = (rng() * 2 - 1) * JITTER_X;
      nodes[key].jy = (rng() * 2 - 1) * JITTER_Y;
    }
  }
  return null;   // this board cannot be tidied — roll another
}

/**
 * Chance the act spawns a red MYTHIC event node, per act index.
 *
 * CLAMPED AT THE LAST RUNG (ENDLESS, 2026-08-05). Every endless act is at
 * least as deep as the Crucible, so it keeps the Crucible's rate rather than
 * falling off the end of the table into the old 0.1 default — which would have
 * made endless act 5 LESS likely to light a Crimson Forge than act 3.
 */
export const MYTHIC_NODE_CHANCE = [0.06, 0.10, 0.15, 0.22];
export const mythicNodeChance = (actIndex) =>
  MYTHIC_NODE_CHANCE[Math.min(Math.max(Math.floor(actIndex) || 0, 0), MYTHIC_NODE_CHANCE.length - 1)];

/**
 * PACING PASS (JC, 2026-07-31). Two asks: one MORE fight per act on average,
 * and shops you can actually plan a route around. The fight weight went 5.0 →
 * 6.9 and the event weight 2.2 → 1.45; the shop weight went 0.8 → 0.9 and is
 * then backed by hard guarantees below (≥2 shops, ≤3, and at least one
 * walkable route through two of them). Net over 1000 seeds per act — the node
 * COUNT is unchanged (the walks carve it), only the mix moved:
 *
 *            fights   events   shops   elites   rests   nodes
 *   before    11.74     4.29    1.36     2.22    2.19    21.80
 *   after     12.89     2.40    2.43     2.17    2.16    22.04
 *
 * Shops per act ran 1-5 before (81% of boards had NO route through two of
 * them); they now run 2-3, 100% of boards have one, and no two stalls ever
 * touch. The extra fight is paid for out of events, not out of elites/rests.
 */
const TYPE_WEIGHTS = [
  { type: 'fight', w: 6.9, min: 1, max: MAP_ROWS - 2 },
  { type: 'event', w: 1.45, min: 1, max: MAP_ROWS - 2 },
  { type: 'elite', w: 1.8, min: 3, max: MAP_ROWS - 2 },
  { type: 'rest',  w: 0.9, min: 3, max: MAP_ROWS - 3 },
  { type: 'shop',  w: 0.9, min: 2, max: MAP_ROWS - 2 },
];

/** Shops per act: never fewer than two, never more than three. */
export const SHOP_MIN = 2;
export const SHOP_MAX = 3;

const id = (row, col) => `${row}-${col}`;

function pickWeighted(entries, rng) {
  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of entries) { r -= e.w; if (r <= 0) return e; }
  return entries[entries.length - 1];
}

/**
 * The start→summit walk that passes the MOST shops, as a node list. A linear
 * DP over the DAG (every edge climbs a row, so it can never loop): the best
 * route out of a node is that node's own shop-ness plus the best route out of
 * its richest child. Used by the generator to place the two-shop guarantee, and
 * by the tests to prove it.
 */
function bestShopRoute(nodes, starts, bossId) {
  const memo = {};
  const walk = (id) => {
    if (memo[id]) return memo[id];
    const n = nodes[id];
    // -1, not 0: a subtree with no shops in it is still a REAL continuation of
    // the walk, and the returned path has to run all the way to the summit or
    // the generator's two-shop fix-up has nowhere left to put the second stall.
    let best = { count: -1, path: [] };
    for (const nx of n.next) {
      if (nx === bossId) continue;
      const r = walk(nx);
      if (r.count > best.count) best = r;
    }
    if (best.count < 0) best = { count: 0, path: [] };
    return (memo[id] = { count: (n.type === 'shop' ? 1 : 0) + best.count, path: [n, ...best.path] });
  };
  let best = { count: -1, path: [] };
  for (const s of starts) {
    const r = walk(s.id);
    if (r.count > best.count) best = r;
  }
  return best.path;
}

/** How many shops the richest walkable route through `map` passes. Test hook. */
export function maxShopsOnARoute(map) {
  const starts = map.starts.map(id => map.nodes[id]);
  return bestShopRoute(map.nodes, starts, map.bossId).filter(n => n.type === 'shop').length;
}

/**
 * The merchant contract, checked on the FINISHED board (leap edges included,
 * since a leap can weld two shops together after the fact): 2-3 stalls, no two
 * of them touching, and at least one walkable route through two. A board that
 * misses it is thrown away and rolled again — see generateMap's retry.
 */
function shopsAreLegal(map) {
  const stalls = Object.values(map.nodes).filter(n => n.id !== map.bossId && n.type === 'shop');
  if (stalls.length < SHOP_MIN || stalls.length > SHOP_MAX) return false;
  for (const s of stalls) {
    for (const nx of s.next) if (map.nodes[nx]?.type === 'shop') return false;
  }
  return maxShopsOnARoute(map) >= SHOP_MIN;
}

/** How many boards the generator may throw away chasing the shop contract. */
const MAX_MAP_ATTEMPTS = 12;

/** Does edge a->b (cols on rows r, r+1) cross an existing edge c->d on the same rows? */
function crosses(edges, row, a, b) {
  for (const [c, d] of edges[row] ?? []) {
    if ((a - c) * (b - d) < 0) return true;
  }
  return false;
}

export function generateMap(actIndex = 0, rng = Math.random, attempt = 0) {
  const nodes = {};
  const edgeSets = {};   // row -> [[fromCol, toCol]]
  const edges = {};      // "row-col" -> Set of next ids

  const ensureNode = (row, col) => {
    const key = id(row, col);
    if (!nodes[key]) {
      nodes[key] = {
        id: key, row, col, type: null, mythic: false, next: [], leaps: [], visited: false,
        // Elite bookkeeping, filled in by assignEliteEncounters once the act is
        // known. `eliteIdx` is WHICH group stands here (drawn without
        // replacement); `forged` is the 1-in-4 hardened one. Both are decided at
        // generation and never re-rolled — see the block at the bottom of this file.
        eliteIdx: null, forged: false,
        jx: (rng() * 2 - 1) * 46, jy: (rng() * 2 - 1) * 30,
      };
      edges[key] = new Set();
    }
    return nodes[key];
  };

  // ---- Carve the walks (start columns lean toward the map's center) ----
  const startColWeights = [0.4, 1, 1.9, 2.4, 1.9, 1, 0.4];
  const pickStartCol = () => {
    const total = startColWeights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let c = 0; c < MAP_COLS; c++) { r -= startColWeights[c]; if (r <= 0) return c; }
    return Math.floor(MAP_COLS / 2);
  };
  const startCols = [];
  for (let w = 0; w < WALKS; w++) {
    let col;
    do {
      col = pickStartCol();
    } while (w === 1 && col === startCols[0]);   // ≥2 distinct starting doors
    startCols.push(col);
    ensureNode(0, col);
    for (let row = 0; row < MAP_ROWS - 1; row++) {
      // Funnel: the higher we climb, the harder the walk pulls to center.
      const center = (MAP_COLS - 1) / 2;
      const pull = row / (MAP_ROWS - 1);
      const drifted = [col - 1, col, col + 1].filter(c => c >= 0 && c < MAP_COLS);
      drifted.sort((a, b) =>
        (Math.abs(a - center) * pull + rng() * (1.2 - pull)) -
        (Math.abs(b - center) * pull + rng() * (1.2 - pull)));
      let next = col;   // straight up never crosses a diagonal on an integer lattice
      for (const c of drifted) {
        if (!crosses(edgeSets, row, col, c)) { next = c; break; }
      }
      ensureNode(row + 1, next);
      (edgeSets[row] ??= []).push([col, next]);
      edges[id(row, col)].add(id(row + 1, next));
      col = next;
    }
  }
  for (const key of Object.keys(edges)) nodes[key].next = [...edges[key]].sort();

  // ---- Boss on top, fed by every summit node ----
  const bossId = 'boss';
  nodes[bossId] = { id: bossId, row: MAP_ROWS, col: (MAP_COLS - 1) / 2, type: 'boss', mythic: false, eliteIdx: null, forged: false, next: [], leaps: [], visited: false, jx: 0, jy: 0 };
  for (const n of Object.values(nodes)) {
    if (n.row === MAP_ROWS - 1) n.next = [bossId];
  }

  // ---- Assign types ----
  const byRow = row => Object.values(nodes).filter(n => n.row === row);
  const parentsOf = node => Object.values(nodes).filter(n => n.next.includes(node.id));

  for (let row = 0; row < MAP_ROWS; row++) {
    for (const n of byRow(row)) {
      if (row === 0) { n.type = 'fight'; continue; }
      if (row === MAP_ROWS - 1) { n.type = 'rest'; continue; }   // breather before the boss
      const parentTypes = new Set(parentsOf(n).map(p => p.type));
      const candidates = TYPE_WEIGHTS.filter(e =>
        row >= e.min && row <= e.max &&
        // fights/events may chain; the "special" rooms never directly follow their own kind
        (e.type === 'fight' || e.type === 'event' || !parentTypes.has(e.type)));
      n.type = pickWeighted(candidates, rng).type;
    }
  }

  // ---- Guarantees: shops to spend chips in, elites to farm, fires to rest at ----
  const all = Object.values(nodes).filter(n => n.id !== bossId);
  /** Is `n` wedged directly against a room of type `t` (either direction)? */
  const touches = (n, t) => Object.values(nodes).some(o =>
    o.type === t && o.id !== n.id && (o.next.includes(n.id) || n.next.includes(o.id)));
  const convert = (want, count, rowMin, rowMax, ok = null) => {
    let have = all.filter(n => n.type === want).length;
    // Convert fights first; on tight funnel maps, fall back to events.
    for (const source of ['fight', 'event']) {
      const pool = all.filter(n => n.type === source && n.row >= rowMin && n.row <= rowMax && (!ok || ok(n)));
      pool.sort(() => rng() - 0.5);
      for (const n of pool) {
        if (have >= count) break;
        n.type = want; have++;
      }
      if (have >= count) break;
    }
    return have;
  };
  // Two merchants, never welded to each other (the type roll already forbids
  // shop-after-shop; the guarantee pass has to honour the same rule).
  convert('shop', SHOP_MIN, 2, MAP_ROWS - 2, n => !touches(n, 'shop'));
  convert('elite', 2, 3, MAP_ROWS - 2);
  convert('rest', 2, 2, MAP_ROWS - 3);   // incl. the guaranteed pre-boss rest = min 2 total

  // ---- THE TWO-SHOP ROUTE (JC, 2026-07-31) ----------------------------------
  // Two shops SOMEWHERE on the board is not the same promise as two shops you
  // can actually walk through: on the old generator only ~19% of maps had a
  // route that hit a second merchant, so "save up and come back" was a plan the
  // map kept refusing. The guarantee is now on the ROUTE — at least one
  // start→boss walk passes two shops — with the count still capped at three so
  // the act doesn't turn into a high street.
  const route = bestShopRoute(nodes, byRow(0), bossId);
  const routeShops = () => route.filter(n => n.type === 'shop').length;
  const placeOnRoute = () => {
    for (let i = 0; i < route.length && routeShops() < SHOP_MIN; i++) {
      const n = route[i];
      if (n.type !== 'fight' && n.type !== 'event') continue;
      if (n.row < 2 || n.row > MAP_ROWS - 2) continue;
      if (touches(n, 'shop')) continue;   // never two merchants back to back
      n.type = 'shop';
    }
  };
  placeOnRoute();
  // On a tight funnel every convertible room on the route can already neighbour
  // a stall — and that stall is always one the guarantee pass put somewhere
  // ELSE. Pull it off the board and try again: the promise is the ROUTE, not
  // any particular pin, and the no-adjacent-shops rule is never bent.
  if (routeShops() < SHOP_MIN) {
    for (const s of all.filter(n => n.type === 'shop' && !route.includes(n))) s.type = 'fight';
    placeOnRoute();
  }
  // ...and trim the excess, off-route stalls first, so the cap holds.
  const onRoute = new Set(route.map(n => n.id));
  let shops = all.filter(n => n.type === 'shop');
  if (shops.length > SHOP_MAX) {
    const droppable = [
      ...shops.filter(n => !onRoute.has(n.id)),
      ...shops.filter(n => onRoute.has(n.id)).slice(SHOP_MIN),
    ];
    for (const n of droppable) {
      if (shops.length <= SHOP_MAX) break;
      n.type = 'fight';
      shops = shops.filter(s => s !== n);
    }
  }

  // ---- THE BOARD IS TIDIED BEFORE ANYTHING IS ROUTED OVER IT ----------------
  // Rooms stop being too close together and straight trails stop grazing rooms
  // they do not connect to. Positions are final after this line, which is what
  // lets the leap block below vet its own arcs. See tidyJitter.
  // ...and a board whose floors are laid out so that a trail HAS to stretch past
  // a room it does not connect to is thrown away and rolled again, the same way
  // a board that misses the merchant contract is. ~0.4% of rolls.
  let pos = tidyJitter(nodes, MAP_ROWS, bossId, rng);
  if (!pos) {
    if (attempt < MAX_MAP_ATTEMPTS) return generateMap(actIndex, rng, attempt + 1);
    // Out of attempts (never observed): flatten onto the bare lattice, which is
    // at least a legible board, and let mapPathAudit report what is left.
    for (const n of all) { n.jx = 0; n.jy = 0; }
    pos = mapLayout({ nodes, rows: MAP_ROWS, bossId }).pos;
  }

  // ---- LEAP EDGES: skip a floor; shortcuts favor the dangerous & the strange ----
  //
  // CLEARANCE IS PART OF WHETHER THE LEAP EXISTS (JC, 2026-08-11), not a note
  // for the renderer. A leap is only created when there is an arc between its
  // two ends that stays NODE_CLEAR_RADIUS clear of every room it flies over —
  // otherwise the board would be drawing a trail that touches a room the leap
  // does not connect to, and the one rule the map is read by ("a trail that
  // touches a room goes through it") would be broken by the very edge whose
  // whole point is that it does NOT go through that room.
  //
  // A refused target is simply not leapt to: we walk the rest of the candidates
  // in the same juiciest-first order, and a donor with no clear arc anywhere
  // spends nothing out of the ≤3 budget. Elite/event targeting and the budget
  // are exactly as they were.
  let leaps = 0;
  const leapDonors = all.filter(n => n.row <= MAP_ROWS - 3).sort(() => rng() - 0.5);
  for (const n of leapDonors) {
    if (leaps >= MAX_LEAPS) break;
    if (rng() > LEAP_CHANCE) continue;
    // A leap must never weld one merchant onto the next — the arc is a
    // shortcut, not a licence to break the no-adjacent-shops rule.
    const targets = byRow(n.row + 2).filter(t => Math.abs(t.col - n.col) <= 1 && !n.next.includes(t.id)
      && !(n.type === 'shop' && t.type === 'shop'));
    if (!targets.length) continue;
    targets.sort((a, b) => {
      const juicy = t => (t.type === 'elite' ? 0 : t.type === 'event' ? 1 : 2);
      return juicy(a) - juicy(b) || rng() - 0.5;
    });
    for (const t of targets) {
      const arc = leapBulge(pos, n.id, t.id);
      if (!arc || arc.clearance < NODE_CLEAR_RADIUS) continue;   // no clear corridor: no leap here
      n.next = [...n.next, t.id].sort();
      n.leaps.push(t.id);
      leaps++;
      break;
    }
  }

  // ---- The red one ----
  if (rng() < mythicNodeChance(actIndex)) lightMythicNode(all, rng);

  const map = { rows: MAP_ROWS, cols: MAP_COLS, nodes, starts: byRow(0).map(n => n.id).sort(), bossId, currentId: null, taken: [] };
  // The merchant contract is checked on the FINISHED board — a leap edge or a
  // trim can undo what the guarantee pass arranged — and a board that misses it
  // is simply rolled again. Empirically this fires on well under 1 in 1,000
  // boards, so the retry is a safety net rather than a loop.
  if (attempt < MAX_MAP_ATTEMPTS && !shopsAreLegal(map)) return generateMap(actIndex, rng, attempt + 1);
  return map;
}

/**
 * Turn one deep room red. A mystery node is the natural host; a fight will do
 * if the board dealt no late mystery at all. Returns the node it lit, or null
 * when the board has nowhere to put one.
 *
 * Hoisted out of generateMap so the ORACLE'S BLACKSMITH can use exactly the
 * same rule (see forceMythicNode) instead of inventing a second one — a
 * guaranteed forge has to stand in the same kind of room as a rolled one.
 */
function lightMythicNode(nodes, rng = Math.random) {
  const deep = n => n.row >= 4 && !n.visited;
  const hosts = nodes.filter(n => n.type === 'event' && deep(n));
  const fallback = nodes.filter(n => n.type === 'fight' && deep(n));
  const pick = hosts.length ? hosts[Math.floor(rng() * hosts.length)]
    : fallback.length ? fallback[Math.floor(rng() * fallback.length)] : null;
  if (pick) { pick.type = 'event'; pick.mythic = true; }
  return pick;
}

/**
 * THE BLACKSMITH'S PROMISE, on a FINISHED board: make sure this act has a red
 * node, and say whether the debt is now settled.
 *
 * A board that already rolled one keeps it and answers true — the promise was
 * "a guaranteed Forge event", not "a second one". A board with nowhere to put
 * one answers false, and the debt rides to the next act.
 */
export function forceMythicNode(map, rng = Math.random) {
  const nodes = Object.values(map?.nodes ?? {});
  if (nodes.some(n => n.mythic)) return true;
  return !!lightMythicNode(nodes, rng);
}

/** Which node ids can be entered right now? */
export function reachable(map) {
  if (!map.currentId) return map.starts;
  return map.nodes[map.currentId].next;
}

/** Commit to a node. Returns the node. `force` skips reachability (dev mode). */
export function enterNode(map, nodeId, force = false) {
  if (!force && !reachable(map).includes(nodeId)) throw new Error(`enterNode: ${nodeId} not reachable`);
  map.currentId = nodeId;
  map.taken.push(nodeId);
  map.nodes[nodeId].visited = true;
  return map.nodes[nodeId];
}

// ---------------------------------------------------------------------------
// ELITES — THE NO-REPEAT BAG AND THE FORGED ROLL (JC, PATCH 0803 §2)
// ---------------------------------------------------------------------------
/**
 * Both live HERE, on the map, and both are decided ONCE when the act's board is
 * generated — exactly the way `map.bossPick` is. Phaser scenes are singletons
 * and MapScene restarts on every overlay that resolves, so anything rolled at
 * RENDER time re-rolls itself into a different answer the moment the player
 * opens a shop; anything rolled at FIGHT time re-rolls on a save/resume. Written
 * on the node at generation, it survives both for free: `map` is already a
 * PLAIN_FIELD in core/save.js, so every flag below JSONs and comes back as
 * itself with no save-format work at all.
 *
 * A board built by an older build has `eliteIdx: undefined` and `forged:
 * undefined` on its nodes. Both read as "roll it the old way" / "not forged", so
 * an in-flight save keeps working and simply never meets a Forged elite.
 */

/** 1 in 4 elites on a map is FORGED. */
export const FORGED_ELITE_CHANCE = 0.25;
/** What being Forged is worth to the body: +50% HP, +30% damage. */
export const FORGED_HP_MULT = 1.5;
export const FORGED_DMG_MULT = 1.3;
/**
 * ...and what it costs to meet one: NOTHING below IRON. Named by difficulty id
 * rather than by index so a reshuffle of the ladder can't silently move the gate
 * (difficultyIndex resolves an id, a name or a number).
 */
export const FORGED_MIN_DIFFICULTY = 'iron';

/** Is the FORGED tier unlocked on this difficulty (index, id or garbage)? */
export function forgedUnlocked(difficulty) {
  return difficultyIndex(difficulty) >= difficultyIndex(FORGED_MIN_DIFFICULTY);
}

/** This board's elite rooms, in a stable board order (row, then column). */
export function eliteNodes(map) {
  return Object.values(map?.nodes ?? {})
    .filter(n => n.id !== map.bossId && n.type === 'elite')
    .sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

/** 0..n-1, shuffled. Fisher-Yates on the injected rng, so a seed reproduces. */
function shuffledIndices(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * DRAW WITHOUT REPLACEMENT. One index out of the act's elite pool, taken from
 * `map.eliteBag` — and when the bag runs dry it is refilled with a fresh shuffle
 * of every group, which is the whole reason the reshuffle exists: an act with
 * more elite ROOMS than elite GROUPS (or a future endless mode that keeps
 * walking) must still be able to answer, and the cheapest honest answer is
 * "everything else has been used, so start the round again".
 *
 * Stale entries are filtered on the way out, so a build that SHRINKS an act's
 * elite pool can never hand a live save an index off the end of the array.
 */
export function drawEliteIndex(map, poolSize, rng = Math.random) {
  if (!(poolSize > 0)) return null;
  if (!Array.isArray(map.eliteBag)) map.eliteBag = [];
  map.eliteBag = map.eliteBag.filter(i => Number.isInteger(i) && i >= 0 && i < poolSize);
  if (!map.eliteBag.length) map.eliteBag = shuffledIndices(poolSize, rng);
  return map.eliteBag.pop();
}

/**
 * Deal every elite room on a finished board its group and its Forged flag.
 * Called once, from run.newActMap, next to the boss roll.
 *
 * @param map            a generated map
 * @param elitePoolSize  how many elite GROUPS this act fields (act.pools.elite.length)
 * @param difficulty     the run's difficulty (index/id) — gates FORGED
 */
export function assignEliteEncounters(map, elitePoolSize, { rng = Math.random, difficulty = 0 } = {}) {
  const forgeable = forgedUnlocked(difficulty);
  map.eliteBag = [];   // a fresh act always opens on a full, freshly shuffled bag
  for (const n of eliteNodes(map)) {
    n.eliteIdx = drawEliteIndex(map, elitePoolSize, rng);
    n.forged = forgeable && rng() < FORGED_ELITE_CHANCE;
  }
  return map;
}
