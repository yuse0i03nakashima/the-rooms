// Haskell が書き出したベクタと JavaScript の実装が一致することを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cells, allowed, conflicts, attacks, conflict, key } from '../js/rules.js';
import { countSolutions, level, hintCell, deduceWith, FULL, initial, place } from '../js/solver.js';

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const puzzleOf = (v) => ({ size: v.size, rooms: v.rooms });

test('ベクタが読める', () => { assert.ok(vectors.length >= 10); });

test('attacks / conflict の基本', () => {
  assert.ok(attacks([0, 0], [0, 4]));
  assert.ok(attacks([1, 1], [2, 2]));
  assert.ok(!attacks([0, 0], [2, 2]));
  assert.ok(!attacks([1, 1], [1, 1]));
  const pz = { size: 3, rooms: [[0, 0, 1], [0, 1, 1], [2, 2, 2]] };
  assert.ok(conflict(pz, [0, 1], [1, 0]));   // 同じ部屋(かつ斜め)
  assert.ok(conflict(pz, [0, 0], [1, 0]));
});

test('allowed がベクタと一致', () => {
  for (const v of vectors) {
    const pz = puzzleOf(v);
    const got = cells(pz).map((q) => allowed(pz, v.placed, q));
    assert.deepEqual(got, v.allowed);
  }
});

test('conflicts の数がベクタと一致', () => {
  for (const v of vectors) assert.equal(conflicts(puzzleOf(v), v.placed).length, v.conflicts);
});

test('solutions の数(3 で打ち切り)がベクタと一致', () => {
  for (const v of vectors) assert.equal(countSolutions(3, puzzleOf(v)), v.solutions);
});

test('level がベクタと一致', () => {
  for (const v of vectors) assert.equal(level(puzzleOf(v)), v.level);
});

test('hint と推論後の候補がベクタと一致', () => {
  for (const v of vectors) {
    const pz = puzzleOf(v);
    // 正解の駒(placedCorrect)だけを置いた状態から推論する
    let st = initial(pz);
    for (const p of v.placedCorrect) st = place(pz, p, st);
    const got = hintCell(pz, st);
    assert.deepEqual(got, v.hint);
    const ded = [...deduceWith(FULL, pz, st).state.cands].sort((a, b) => a - b);
    assert.deepEqual(ded, v.deduced.map(key).sort((a, b) => a - b));
  }
});
