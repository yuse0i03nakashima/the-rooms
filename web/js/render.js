// Board の描画(DOM)。マスは部屋ごとの色、部屋の境界に太い線。
import { EMPTY, MARK, PIECE } from './game.js';

export class Renderer {
  constructor(boardEl) {
    this.el = boardEl;
    this.cells = [];
    this.puzzle = null;
  }

  // Stage の始まりに一度だけ組み立てる
  build(puzzle) {
    this.puzzle = puzzle;
    const n = puzzle.size;
    this.el.innerHTML = '';
    this.el.style.setProperty('--n', n);
    this.cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const k = puzzle.rooms[r][c];
      const d = document.createElement('button');
      d.type = 'button';
      d.className = `cell room-${k % 10}`;
      d.dataset.r = r; d.dataset.c = c;
      if (r === 0 || puzzle.rooms[r - 1][c] !== k) d.classList.add('bt');
      if (r === n - 1 || puzzle.rooms[r + 1][c] !== k) d.classList.add('bb');
      if (c === 0 || puzzle.rooms[r][c - 1] !== k) d.classList.add('bl');
      if (c === n - 1 || puzzle.rooms[r][c + 1] !== k) d.classList.add('br');
      d.innerHTML = '<span class="x">×</span><span class="piece"></span>';
      this.el.appendChild(d);
      this.cells.push(d);
    }
  }

  cellAt([r, c]) { return this.cells[r * this.puzzle.size + c]; }

  // マークの状態を反映する
  update(st) {
    const n = st.size;
    for (let i = 0; i < n * n; i++) {
      const d = this.cells[i];
      const m = st.marks[i];
      d.classList.toggle('mark', m === MARK);
      d.classList.toggle('piece', m === PIECE);
      d.classList.toggle('empty', m === EMPTY);
      d.classList.toggle('hint', st.hint !== null && st.hint === (Math.floor(i / n) * 16 + (i % n)));
    }
  }

  // 完成した行・列・部屋を光らせる
  markDone(positions) {
    for (const p of positions) this.cellAt(p).classList.add('done');
  }

  flashWrong(pos) {
    const d = this.cellAt(pos);
    d.classList.remove('wrong'); void d.offsetWidth; d.classList.add('wrong');
  }

  pop(pos) {
    const d = this.cellAt(pos);
    d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop');
  }

  center(pos) {
    const r = this.cellAt(pos).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }
}
