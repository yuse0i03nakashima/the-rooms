import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../js/config.js';
import { Game, MARK, PIECE } from '../js/game.js';
import { isUnique } from '../js/solver.js';
import { key } from '../js/rules.js';

const stages = JSON.parse(readFileSync(new URL('../levels/stages.json', import.meta.url), 'utf8'));

class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.get(k) ?? null; } setItem(k, v) { this.m.set(k, v); } }

const solutionCells = (g) => [...g.stage.solution].map((k) => [Math.floor(k / 16), k % 16]);
const wrongCell = (g) => {
  const n = g.stage.size;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!g.stage.solution.has(key([r, c]))) return [r, c];
  return null;
};

test('全 Stage の面が唯一解で、solution が正しい', () => {
  for (const def of stages) {
    for (const b of def.boards) {
      const pz = { size: def.size, rooms: b.rooms };
      assert.ok(isUnique(pz), `stage ${def.stage}`);
      assert.equal(b.solution.length, def.size);
    }
  }
});

test('タップ: 空 → × → 駒。正しい駒で得点、全部置くと Clear', () => {
  const g = new Game(CONFIG, stages, new MemStorage());
  g.startStage(1, 0);
  const sol = solutionCells(g);
  let ev = g.tap(sol[0], 100);
  assert.equal(ev[0].type, 'mark');
  ev = g.tap(sol[0], 200);
  assert.equal(ev[0].type, 'place');
  assert.equal(ev[0].points, 100 * 1.5);     // Chain 1 → ×1.5
  assert.equal(g.markAt(sol[0]), PIECE);
  let last;
  for (const q of sol.slice(1)) { g.tap(q, 300); last = g.tap(q, 300); }
  assert.equal(last.at(-1).type, 'stageClear');
  const clear = last.at(-1);
  assert.ok(clear.perfect);
  assert.equal(clear.stars, 3);
  assert.ok(clear.timeBonus > 0);
  assert.equal(g.progress.stageReached, 2);
  assert.equal(g.progress.stageBest[1], clear.stageScore);
});

test('間違えると Heart が減り Chain が切れる。Heart 0 で Run Over', () => {
  const g = new Game(CONFIG, stages, new MemStorage());
  g.autoMark = false;   // 自動の × で手順が変わらないように
  g.startStage(1, 0);
  const sol = solutionCells(g);
  g.tap(sol[0], 0); g.tap(sol[0], 0);
  assert.equal(g.stage.chain, 1);
  const w = wrongCell(g);
  g.tap(w, 0);
  let ev = g.tap(w, 0);
  assert.equal(ev[0].type, 'wrong');
  assert.equal(g.run.lives, 2);
  assert.equal(g.stage.chain, 0);
  assert.equal(g.markAt(w), MARK);
  ev = g.tap(w, 0);   // × のままなので 1 タップで 2 回目の間違い
  assert.equal(g.run.lives, 1);
  ev = g.tap(w, 0);
  assert.equal(ev.at(-1).type, 'runOver');
  assert.equal(g.run.lives, CONFIG.lives.start);
  assert.equal(g.run.stage, 1);
});

test('駒を置くと、ぶつかるマスに × が自動で付く', () => {
  const g = new Game(CONFIG, stages, new MemStorage());
  g.startStage(1, 0);
  const q = solutionCells(g)[0];
  g.tap(q, 0);
  const ev = g.tap(q, 0)[0];
  assert.ok(ev.auto.length > 0);
  for (const a of ev.auto) assert.equal(g.markAt(a), MARK);
});

test('Hint は正解のマスを示し、Chain を切り、回数に上限がある', () => {
  const g = new Game(CONFIG, stages, new MemStorage());
  g.startStage(3, 0);
  const sol = solutionCells(g);
  g.tap(sol[0], 0); g.tap(sol[0], 0);
  const ev = g.hint(0)[0];
  assert.equal(ev.type, 'hint');
  assert.ok(g.stage.solution.has(key(ev.pos)));
  assert.equal(g.stage.chain, 0);
  assert.equal(g.stage.hint, key(ev.pos));
  g.hint(0); g.hint(0);
  assert.equal(g.hint(0)[0].type, 'hintNone');
  // 正解のマスに × を付けていると、そこを教える
  const g2 = new Game(CONFIG, stages, new MemStorage());
  g2.startStage(2, 0);
  const s2 = solutionCells(g2);
  g2.tap(s2[1], 0);
  assert.deepEqual(g2.hint(0)[0].pos, s2[1]);
});

test('保存と読み込み。Give up は Heart −1 で別の面', () => {
  const store = new MemStorage();
  const g = new Game(CONFIG, stages, store);
  g.startStage(1, 0);
  const sol = solutionCells(g);
  for (const q of sol) { g.tap(q, 0); g.tap(q, 0); }
  g.nextStage(0);
  const g2 = new Game(CONFIG, stages, store);
  assert.equal(g2.run.stage, 2);
  assert.equal(g2.progress.stageReached, 2);
  g2.startStage(2, 0);
  const rooms0 = g2.stage.puzzle.rooms;
  const ev = g2.giveUp(0);
  assert.equal(ev[0].type, 'stageFailed');
  assert.equal(g2.run.lives, 2);
  assert.equal(g2.stage.stage, 2);
  assert.notDeepEqual(g2.stage.puzzle.rooms, rooms0);
});
