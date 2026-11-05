// ゲーム進行: Stage・Score・Chain・Heart・Hint・記録。画面や音は持たない(main.js が events を受けて演出する)。
import { CONFIG } from './config.js';
import { key, unkey, conflict, same } from './rules.js';
import { initial, place, eliminate, hintCell } from './solver.js';

export const EMPTY = 0, MARK = 1, PIECE = 2;

export function emptyProgress() {
  return { stageReached: 1, best: 0, stageBest: {}, stars: {}, attempts: {}, clears: 0 };
}
export function emptyRun() {
  return { stage: 1, score: 0, lives: CONFIG.lives.start, worldStart: 1 };
}

export class Game {
  constructor(cfg, stages, storage = null) {
    this.cfg = cfg;
    this.stages = stages;
    this.storage = storage;
    this.progress = emptyProgress();
    this.run = emptyRun();
    this.autoMark = cfg.autoMark;
    this.stage = null;
    this.load();
  }

  // ---------- 保存 ----------
  load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.cfg.save.key);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.progress = { ...emptyProgress(), ...(data.progress ?? {}) };
      this.run = { ...emptyRun(), ...(data.run ?? {}) };
      if (typeof data.autoMark === 'boolean') this.autoMark = data.autoMark;
    } catch { /* 壊れた保存は捨てる */ }
  }
  save() {
    if (!this.storage) return;
    try { this.storage.setItem(this.cfg.save.key, JSON.stringify({ progress: this.progress, run: this.run, autoMark: this.autoMark })); } catch { /* 無視 */ }
  }
  resetAll() { this.progress = emptyProgress(); this.run = emptyRun(); this.stage = null; this.save(); }

  // ---------- Stage ----------
  get stageCount() { return this.stages.length; }
  stageDef(n) { return this.stages[n - 1]; }
  boardFor(n) {
    const def = this.stageDef(n);
    const attempts = this.progress.attempts[n] ?? 0;
    return def.boards[attempts % def.boards.length];
  }
  worldOf(n) { return Math.floor((n - 1) / this.cfg.world.stagesPer) + 1; }
  isWorldEnd(n) { return n % this.cfg.world.stagesPer === 0 || n === this.stageCount; }

  startStage(n, now = 0) {
    const def = this.stageDef(n);
    const board = this.boardFor(n);
    const size = def.size;
    const puzzle = { size, rooms: board.rooms };
    const solution = new Set(board.solution.map((c, r) => key([r, c])));
    this.run.stage = n;
    this.stage = {
      stage: n, size, puzzle, solution, level: board.level,
      marks: new Uint8Array(size * size),
      scored: new Set(),
      mistakes: 0, hints: 0, chain: 0, maxChain: 0,
      startedAt: now, score: 0, status: 'play', hint: null, placed: 0,
    };
    this.save();
    return [{ type: 'stageStart', stage: n, size, level: board.level, lives: this.run.lives, world: this.worldOf(n), worldStart: this.run.worldStart }];
  }

  get mult() {
    const st = this.stage;
    if (!st) return 1;
    return Math.min(this.cfg.score.maxMult, 1 + st.chain * this.cfg.score.chainStep);
  }
  idx([r, c]) { return r * this.stage.size + c; }
  markAt(pos) { return this.stage.marks[this.idx(pos)]; }
  pieces() {
    const out = [];
    const n = this.stage.size;
    for (let i = 0; i < n * n; i++) if (this.stage.marks[i] === PIECE) out.push([Math.floor(i / n), i % n]);
    return out;
  }

  // ---------- 操作 ----------
  // 空 → × → 駒 → 空 の順に変わる。駒を置く瞬間だけ正誤を判定する。
  tap(pos, now = 0) {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const i = this.idx(pos);
    const m = st.marks[i];
    if (m === EMPTY) { st.marks[i] = MARK; return [{ type: 'mark', pos }]; }
    if (m === PIECE) { st.marks[i] = EMPTY; st.placed--; return [{ type: 'unmark', pos }]; }
    // × → 駒
    const k = key(pos);
    if (!st.solution.has(k)) {
      st.mistakes++;
      st.chain = 0;
      this.run.lives--;
      const events = [{ type: 'wrong', pos, lives: this.run.lives, mistakes: st.mistakes }];
      if (this.run.lives <= 0) events.push(...this.runOver());
      else this.save();
      return events;
    }
    st.marks[i] = PIECE;
    st.placed++;
    let points = 0;
    if (!st.scored.has(k)) {
      st.scored.add(k);
      st.chain++;
      st.maxChain = Math.max(st.maxChain, st.chain);
      points = Math.round(this.cfg.score.placeBase * this.mult);
      st.score += points;
    }
    if (st.hint === k) st.hint = null;
    const auto = [];
    if (this.autoMark) {
      const n = st.size;
      for (let j = 0; j < n * n; j++) {
        if (st.marks[j] !== EMPTY) continue;
        const q = [Math.floor(j / n), j % n];
        if (conflict(st.puzzle, pos, q)) { st.marks[j] = MARK; auto.push(q); }
      }
    }
    const events = [{ type: 'place', pos, points, mult: this.mult, chain: st.chain, auto, placed: st.placed, size: st.size }];
    if (st.placed === st.size) events.push(this.stageClear(now));
    return events;
  }

  // 推論で次に確定する駒の位置を示す。Chain が切れ、Score が少し減る。
  hint(now = 0) {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    if (st.hints >= this.cfg.hint.maxPerStage) return [{ type: 'hintNone', reason: 'limit' }];
    const placed = this.pieces();
    let s = initial(st.puzzle);
    for (const p of placed) s = place(st.puzzle, p, s);
    // プレイヤーの × のうち正しいものは候補から外す。正解のマスに × が付いていれば、そこを教える
    const n = st.size;
    const wrongMarks = [];
    const rightMarks = [];
    for (let j = 0; j < n * n; j++) {
      if (st.marks[j] !== MARK) continue;
      const q = [Math.floor(j / n), j % n];
      (st.solution.has(key(q)) ? wrongMarks : rightMarks).push(q);
    }
    s = eliminate(rightMarks, s);
    let pos = wrongMarks[0] ?? hintCell(st.puzzle, s);
    if (!pos) {
      for (const k of st.solution) { if (st.marks[this.idx(unkey(k))] !== PIECE) { pos = unkey(k); break; } }
    }
    if (!pos) return [{ type: 'hintNone', reason: 'done' }];
    st.hints++;
    st.chain = 0;
    st.score = Math.max(0, st.score - this.cfg.score.hintCost);
    st.hint = key(pos);
    return [{ type: 'hint', pos, hints: st.hints, left: this.cfg.hint.maxPerStage - st.hints, cost: this.cfg.score.hintCost }];
  }

  clearMarks() {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    const n = st.size;
    for (let j = 0; j < n * n; j++) if (st.marks[j] === MARK) st.marks[j] = EMPTY;
    return [{ type: 'marksCleared' }];
  }

  // ---------- Stage の終わり ----------
  stageClear(now) {
    const st = this.stage;
    st.status = 'clear';
    const elapsed = Math.max(0, (now - st.startedAt) / 1000);
    const par = st.size * this.cfg.score.timeParPerCell;
    const timeBonus = Math.max(0, Math.floor(par - elapsed)) * this.cfg.score.timePerSecond;
    const perfect = st.mistakes === 0 && st.hints === 0;
    const stars = perfect ? this.cfg.stars.perfect : (st.hints === 0 && st.mistakes <= 1) ? this.cfg.stars.good : this.cfg.stars.clear;
    const stageScore = st.score + this.cfg.score.clearBonus + (perfect ? this.cfg.score.perfectBonus : 0) + timeBonus;
    st.stageScore = stageScore;
    this.run.score += stageScore;
    let lifeGain = false;
    if (perfect && this.run.lives < this.cfg.lives.max) { this.run.lives++; lifeGain = true; }
    const p = this.progress;
    const n = st.stage;
    p.stageReached = Math.max(p.stageReached, Math.min(this.stageCount, n + 1));
    const prevBest = p.stageBest[n] ?? 0;
    const stageBestUpdated = stageScore > prevBest;
    if (stageBestUpdated) p.stageBest[n] = stageScore;
    p.stars[n] = Math.max(p.stars[n] ?? 0, stars);
    p.best = Math.max(p.best, this.run.score);
    p.clears++;
    this.save();
    return {
      type: 'stageClear', stage: n, stageScore, base: st.score, timeBonus, perfect, stars, lifeGain, lives: this.run.lives,
      runScore: this.run.score, best: p.best, prevBest, stageBestUpdated, elapsed, mistakes: st.mistakes, hints: st.hints, maxChain: st.maxChain,
      worldEnd: this.isWorldEnd(n), last: n === this.stageCount, totalStars: this.totalStars(),
    };
  }

  nextStage(now = 0) {
    const n = this.run.stage;
    if (n >= this.stageCount) return [];
    if (this.isWorldEnd(n)) this.run.worldStart = n + 1;
    return this.startStage(n + 1, now);
  }

  // あきらめる: Heart を 1 つ失い、同じ Stage を別の面でやり直す
  giveUp(now = 0) {
    const st = this.stage;
    if (!st || st.status !== 'play') return [];
    this.run.lives--;
    this.progress.attempts[st.stage] = (this.progress.attempts[st.stage] ?? 0) + 1;
    if (this.run.lives <= 0) return [{ type: 'stageFailed', stage: st.stage, lives: 0 }, ...this.runOver()];
    const events = [{ type: 'stageFailed', stage: st.stage, lives: this.run.lives }];
    events.push(...this.startStage(st.stage, now));
    return events;
  }

  // Heart が尽きた: Run の Score を記録し、World の先頭からやり直し
  runOver() {
    const st = this.stage;
    if (st) st.status = 'over';
    const score = this.run.score;
    this.progress.best = Math.max(this.progress.best, score);
    const worldStart = this.run.worldStart;
    this.run = { ...emptyRun(), stage: worldStart, worldStart };
    this.save();
    return [{ type: 'runOver', score, best: this.progress.best, worldStart }];
  }

  // 間違えたあとも同じ面を続ける(Heart が残っているとき)
  totalStars() { return Object.values(this.progress.stars).reduce((a, b) => a + b, 0); }

  // 続きから遊べる Stage(保存された Run の Stage)
  get resumeStage() { return Math.min(this.run.stage, this.stageCount); }

  // 置いてある駒がすべて正しいか(表示の確認用)
  allPlacedCorrect() { return this.pieces().every((q) => this.stage.solution.has(key(q))); }

  static same = same;
}
