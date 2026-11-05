// ルール(Haskell の Rules.hs / Board.hs の移植)。関数名と意味を揃える。
// 位置は [row, col]。部屋は puzzle.rooms[row][col](0 始まり)。

export function cells(puzzle) {
  const n = puzzle.size, out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push([r, c]);
  return out;
}

export function inside(puzzle, [r, c]) {
  return r >= 0 && c >= 0 && r < puzzle.size && c < puzzle.size;
}

export function roomAt(puzzle, [r, c]) { return puzzle.rooms[r][c]; }

export function roomCells(puzzle, k) { return cells(puzzle).filter((q) => roomAt(puzzle, q) === k); }

// 「ひとつずつ置く」単位: 行、列、部屋の順
export function units(puzzle) {
  const n = puzzle.size, out = [];
  for (let r = 0; r < n; r++) out.push(Array.from({ length: n }, (_, c) => [r, c]));
  for (let c = 0; c < n; c++) out.push(Array.from({ length: n }, (_, r) => [r, c]));
  for (let k = 0; k < n; k++) out.push(roomCells(puzzle, k));
  return out;
}

export function neighbors4(n, [r, c]) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n);
}

export const same = (a, b) => a[0] === b[0] && a[1] === b[1];
export const key = ([r, c]) => r * 16 + c;
export const unkey = (k) => [Math.floor(k / 16), k % 16];

// 部屋を考えない「取り合い」: 同じ行、同じ列、または 8 方向に隣接
export function attacks([r1, c1], [r2, c2]) {
  if (r1 === r2 && c1 === c2) return false;
  return r1 === r2 || c1 === c2 || (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1);
}

// 同時に置けない 2 マス: 取り合いか、同じ部屋
export function conflict(puzzle, a, b) {
  return !same(a, b) && (attacks(a, b) || roomAt(puzzle, a) === roomAt(puzzle, b));
}

// 置いてある駒 placed に対して q に新しく置けるか
export function allowed(puzzle, placed, q) {
  return inside(puzzle, q) && !placed.some((p) => same(p, q)) && !placed.some((p) => conflict(puzzle, q, p));
}

// ぶつかっている組
export function conflicts(puzzle, placed) {
  const out = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    if (conflict(puzzle, placed[i], placed[j])) out.push([placed[i], placed[j]]);
  }
  return out;
}

export function isSolved(puzzle, placed) {
  return placed.length === puzzle.size && placed.every((q) => inside(puzzle, q)) && conflicts(puzzle, placed).length === 0;
}
