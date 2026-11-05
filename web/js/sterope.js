// ステロペの立ち絵(384px のスプライトシート)を canvas に描く。
// シートは 1 コマ 320×400、横 6 コマ。コマ数はシートごとに違うので、読み込んだときに
// 透明でないコマを数える(desktop-mate の h384_*.png をそのまま使う)。
const FRAME_W = 320, FRAME_H = 400, COLS = 6;

const SHEETS = {
  idle: 'h384_idle_blink.png',
  happy: 'h384_happy.png',
  think: 'h384_think.png',
  puzzled: 'h384_puzzled.png',
  delight: 'h384_delight.png',
  teary: 'h384_teary.png',
  salute: 'h384_salute.png',
  worried: 'h384_worried.png',
  surprise: 'h384_surprise.png',
  nod: 'h384_nod.png',
  relief: 'h384_relief.png',
};

export class Portrait {
  constructor(canvas, bubbleEl, { base = 'assets/', frameMs = 90, idleHoldMs = 2600 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bubble = bubbleEl;
    this.base = base;
    this.frameMs = frameMs;
    this.idleHoldMs = idleHoldMs;
    this.sheets = {};        // name → { img, frames }
    this.clip = 'idle';
    this.frame = 0;
    this.nextAt = 0;
    this.queue = [];
    this.bubbleTimer = null;
    this.lastSaid = 0;
    canvas.width = FRAME_W; canvas.height = FRAME_H;
    this.load('idle').then(() => this.draw());
    requestAnimationFrame((t) => this.loop(t));
  }

  load(name) {
    if (this.sheets[name]) return this.sheets[name].ready;
    const img = new Image();
    const entry = { img, frames: 1, ok: false };
    entry.ready = new Promise((resolve) => {
      img.onload = () => { entry.frames = countFrames(img); entry.ok = true; resolve(entry); };
      img.onerror = () => resolve(entry);
      img.src = this.base + SHEETS[name];
    });
    this.sheets[name] = entry;
    return entry.ready;
  }

  // 一度だけ再生して idle に戻る
  async play(name) {
    if (!SHEETS[name]) return;
    await this.load(name);
    if (!this.sheets[name].ok) return;
    this.clip = name; this.frame = 0; this.nextAt = performance.now() + this.frameMs;
    this.draw();
  }

  say(text, ms = 2800) {
    if (!this.bubble) return;
    this.bubble.textContent = text;
    this.bubble.hidden = false;
    this.bubble.classList.remove('show'); void this.bubble.offsetWidth; this.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => { this.bubble.classList.remove('show'); }, ms);
    this.lastSaid = performance.now();
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const sheet = this.sheets[this.clip];
    if (!sheet || !sheet.ok || t < this.nextAt) return;
    this.frame++;
    if (this.frame >= sheet.frames) {
      if (this.clip !== 'idle') { this.clip = 'idle'; }
      this.frame = 0;
      this.nextAt = t + (this.clip === 'idle' ? this.idleHoldMs : this.frameMs);
    } else {
      this.nextAt = t + this.frameMs;
    }
    this.draw();
  }

  draw() {
    const sheet = this.sheets[this.clip] ?? this.sheets.idle;
    if (!sheet || !sheet.ok) return;
    const f = Math.min(this.frame, sheet.frames - 1);
    const sx = (f % COLS) * FRAME_W, sy = Math.floor(f / COLS) * FRAME_H;
    this.ctx.clearRect(0, 0, FRAME_W, FRAME_H);
    this.ctx.drawImage(sheet.img, sx, sy, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  }
}

// シートの中で絵のあるコマを数える(末尾の空きコマは数えない)
function countFrames(img) {
  const cols = Math.floor(img.naturalWidth / FRAME_W), rows = Math.floor(img.naturalHeight / FRAME_H);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  let count = 0;
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * FRAME_W, y = Math.floor(i / cols) * FRAME_H;
    const data = g.getImageData(x + 40, y + 20, FRAME_W - 80, FRAME_H - 40).data;
    let seen = false;
    for (let p = 3; p < data.length; p += 4 * 7) { if (data[p] > 10) { seen = true; break; } }
    if (seen) count = i + 1;
  }
  return Math.max(1, count);
}
