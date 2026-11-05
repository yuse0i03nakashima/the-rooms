// ソルバ(Haskell の Solver.hs の移植)。
// solutions: 行ごとの全探索。deduceWith: 3 つの推論規則(Forced / Squeeze / Pair)。
import { cells, units, roomCells, roomAt, allowed, conflict, key, unkey, same } from './rules.js';

export function solutions(puzzle, limit = Infinity) {
  const n = puzzle.size, out = [];
  const go = (r, placed) => {
    if (out.length >= limit) return;
    if (r === n) { out.push(placed.slice()); return; }
    for (let c = 0; c < n; c++) {
      const q = [r, c];
      if (allowed(puzzle, placed, q)) { placed.push(q); go(r + 1, placed); placed.pop(); }
    }
  };
  go(0, []);
  return out;
}

export function countSolutions(cap, puzzle) { return solutions(puzzle, cap).length; }
export function isUnique(puzzle) { return countSolutions(2, puzzle) === 1; }

// 推論の状態: placed は置いた駒、cands は候補(key の Set)
export function initial(puzzle) {
  return { placed: [], cands: new Set(cells(puzzle).map(key)) };
}

export function place(puzzle, q, st) {
  const cands = new Set();
  for (const k of st.cands) { const c = unkey(k); if (!same(c, q) && !conflict(puzzle, q, c)) cands.add(k); }
  return { placed: [q, ...st.placed], cands };
}

export function eliminate(xs, st) {
  const cands = new Set(st.cands);
  for (const x of xs) cands.delete(key(x));
  return { placed: st.placed, cands };
}

export function openUnits(puzzle, st) {
  return units(puzzle).filter((u) => !st.placed.some((p) => u.some((c) => same(c, p))));
}

const candsIn = (st, u) => u.filter((c) => st.cands.has(key(c)));

export function forced(puzzle, st) {
  for (const u of openUnits(puzzle, st)) {
    const cu = candsIn(st, u);
    if (cu.length === 1) return { type: 'forced', pos: cu[0] };
  }
  return null;
}

export function squeeze(puzzle, st) {
  const xs = new Set();
  const cs = [...st.cands].map(unkey);
  for (const u of openUnits(puzzle, st)) {
    const cu = candsIn(st, u);
    if (cu.length === 0) continue;
    for (const c of cs) {
      if (u.some((x) => same(x, c))) continue;
      if (cu.every((x) => conflict(puzzle, c, x))) xs.add(key(c));
    }
  }
  return xs.size ? { type: 'squeeze', cells: [...xs].map(unkey) } : null;
}

export function pairRule(puzzle, st) {
  const n = puzzle.size;
  const open = [];
  for (let k = 0; k < n; k++) {
    const u = roomCells(puzzle, k);
    if (st.placed.some((p) => u.some((c) => same(c, p)))) continue;
    open.push([k, candsIn(st, u)]);
  }
  const xs = new Set();
  const cs = [...st.cands].map(unkey);
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    const [k1, c1] = open[i], [k2, c2] = open[j];
    for (const axis of [0, 1]) {
      const ls = new Set([...c1, ...c2].map((c) => c[axis]));
      if (ls.size !== 2) continue;
      for (const c of cs) {
        if (ls.has(c[axis]) && roomAt(puzzle, c) !== k1 && roomAt(puzzle, c) !== k2) xs.add(key(c));
      }
    }
  }
  return xs.size ? { type: 'pair', cells: [...xs].map(unkey) } : null;
}

export const BASIC = [forced, squeeze];
export const FULL = [forced, squeeze, pairRule];

export function stepWith(rules, puzzle, st) {
  for (const f of rules) {
    const r = f(puzzle, st);
    if (!r) continue;
    const next = r.type === 'forced' ? place(puzzle, r.pos, st) : eliminate(r.cells, st);
    return { rule: r, state: next };
  }
  return null;
}

export function deduceWith(rules, puzzle, st) {
  const used = [];
  let cur = st;
  for (;;) {
    const s = stepWith(rules, puzzle, cur);
    if (!s) return { rules: used, state: cur };
    used.push(s.rule);
    cur = s.state;
  }
}

export const solvedState = (puzzle, st) => st.placed.length === puzzle.size;

// 0: BASIC で解ける、1: FULL が要る、2: 仮置きが要る
export function level(puzzle) {
  if (solvedState(puzzle, deduceWith(BASIC, puzzle, initial(puzzle)).state)) return 0;
  if (solvedState(puzzle, deduceWith(FULL, puzzle, initial(puzzle)).state)) return 1;
  return 2;
}

// いまの状態から推論で最初に確定する駒の位置(ヒント用)
export function hintCell(puzzle, st) {
  const r = deduceWith(FULL, puzzle, st).rules.find((x) => x.type === 'forced');
  return r ? r.pos : null;
}
