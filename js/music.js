// 生成 BGM(音源ファイルを使わず、WebAudio で合成する)。THE ROOMS 用の、少し切なく甘い曲。
//
// ねらい: 書斎で静かに考える時間に合う、ゆっくりした曲。Chain が続くと旋律が入る。
//   調は D メジャー、BPM 84、8 小節の進行(いわゆる王道進行とその受け):
//     IVmaj7 → V7 → iii7 → vi7 → ii7 → V7 → Imaj7 → I6
//   7th と 9th を含む声部で「甘さ」を、iii7 → vi7 の下行で「切なさ」を出す。
//
// 構成:
//   層 1(熱 0〜)       エレピ風の分散和音(8 分)+ 薄いパッド
//   層 2(熱 0.25〜)    旋律(8 小節のフレーズ)+ 柔らかいベース + 裏拍の小さなブラシ
//
// 時間の管理は「先読みスケジューラ」(Chris Wilson, A Tale of Two Clocks):
//   setInterval で 50ms ごとに起き、AudioContext の時計で 0.2 秒先までの音を予約する。

const STEPS_PER_BAR = 16;

// 音名 → 周波数(A4 = 440)。midi 番号で扱う
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 調(長調の主音の midi 番号。C4 = 60)と BPM は設定で変えられる。
// コード進行は度数で持ち、主音から組み立てる。7th を含む 4 声 + 9th
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PROGRESSION = [
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 7, kind: '7' },      // V7
  { degree: 4, kind: 'm7' },     // iii7
  { degree: 9, kind: 'm7' },     // vi7
  { degree: 2, kind: 'm7' },     // ii7
  { degree: 7, kind: '7' },      // V7
  { degree: 0, kind: 'maj7' },   // Imaj7
  { degree: 0, kind: '6' },      // I6
];
const INTERVALS = { maj7: [0, 4, 7, 11, 14], '7': [0, 4, 7, 10, 14], m7: [0, 3, 7, 10, 14], '6': [0, 4, 7, 9, 14] };

function buildChords(tonic) {
  return PROGRESSION.map(({ degree, kind }) => {
    const root = tonic - 12 + degree;                  // 主音の 1 オクターブ下から
    return { root, notes: INTERVALS[kind].map((i) => root + i) };
  });
}
// 旋律の音階(長音階 2 オクターブ)。添字 0 が主音
function buildPenta(tonic) {
  const out = [];
  for (let oct = 0; oct < 2; oct++) for (const d of MAJOR) out.push(tonic + 12 * oct + d);
  return out;
}
// 旋律: [小節内の 16 分の位置(8 小節通し), 音階の添字, 長さ(16 分の数)]
const MELODY = [
  [0, 9, 3], [4, 10, 2], [6, 11, 2], [8, 12, 6],
  [16, 11, 4], [20, 9, 2], [22, 8, 2], [24, 9, 6],
  [32, 6, 4], [36, 8, 2], [38, 9, 2], [40, 11, 6],
  [48, 9, 2], [50, 8, 2], [52, 7, 4], [56, 5, 6],
  [64, 9, 3], [68, 10, 2], [70, 11, 2], [72, 12, 4], [76, 13, 2],
  [80, 11, 6], [88, 9, 2], [90, 8, 2], [92, 7, 4],
  [96, 8, 4], [100, 7, 2], [102, 6, 2], [104, 7, 8],
  [112, 11, 3], [116, 9, 2], [118, 8, 2], [120, 9, 5],
];
const MELODY_LEN = 8 * 16;

export class Music {
  constructor(cfg) {
    this.cfg = cfg;                     // { volume, tonic?, bpm? }
    this.tonic = cfg.tonic ?? 60;       // 60 = C
    this.bpm = cfg.bpm ?? 124;
    this.stepSec = 60 / this.bpm / 4;   // 16 分音符 1 つの秒数
    this.chords = buildChords(this.tonic);
    this.penta = buildPenta(this.tonic);
    this.ctx = null;
    this.heat = 0;
    this.fever = false;
    this.ducked = false;
    this.enabled = true;
    this.playing = false;
    this.layers = 0;                    // いま鳴らしている層の数(小節の頭で heat から決める)
    this.calm = null;                   // CLASSIC モードの設定 { bpm, maxLayers, volume, feverCalm }。null なら通常
    this.pendingBpm = null;             // 次の小節の頭から適用するテンポ
    this.step = 0;                      // 次に予約する 16 分の番号(曲の頭から通し)
    this.nextTime = 0;                  // その 16 分の時刻
    this.timer = null;
  }

  attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.pump = ctx.createGain(); this.pump.gain.value = 1;        // キックに合わせて凹ませる
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 3500; this.lowpass.Q.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 8; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256; this.analyser.smoothingTimeConstant = 0.5;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    // リード用のエコー
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = this.stepSec * 3;   // 付点 8 分
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.35;
    this.delayOut = ctx.createGain(); this.delayOut.gain.value = 0.3;
    this.delay.connect(this.delayFb); this.delayFb.connect(this.delay); this.delay.connect(this.delayOut); this.delayOut.connect(this.lowpass);
    // ドラムはフィルタを通さない(抜けを保つ)
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 1;
    this.drumBus.connect(this.pump);
    this.lowpass.connect(this.pump);
    this.pump.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    // ハイハット・スネア用のノイズを 1 秒ぶん作っておく
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) { this.enabled = on; this.updateMaster(); }

  play() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.layers = this.layersFor(this.heat);
    this.master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.updateMaster(1.5);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop(fade = 1.0) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.0001, t, fade / 4);
  }

  layersFor(heat) {
    const cap = this.calm ? this.calm.maxLayers : 4;
    if (this.fever && !(this.calm && this.calm.feverCalm)) return Math.min(4, cap);
    const n = heat >= 0.75 ? 4 : heat >= 0.5 ? 3 : heat >= 0.25 ? 2 : 1;
    return Math.min(n, cap);
  }

  // CLASSIC モードの入り切り。テンポは次の小節の頭から変わる(途中で変えると拍がよれる)
  setCalm(settings) {
    this.calm = settings;
    this.pendingBpm = settings ? settings.bpm : (this.cfg.bpm ?? 124);
    this.updateMaster(0.8);
  }

  targetVolume() {
    if (!this.enabled) return 0.0001;
    const base = this.calm ? this.calm.volume : this.cfg.volume;
    return Math.max(0.0001, base * (0.9 + this.heat * 0.2) * (this.ducked ? 0.35 : 1));
  }
  updateMaster(tc = 0.5) {
    if (!this.master || !this.playing) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.targetVolume(), t, tc / 3);
  }

  // 熱。層の数は次の小節の頭で変わる。フィルタだけは滑らかに追従する
  setHeat(heat) {
    heat = Math.max(0, Math.min(1, heat));
    if (Math.abs(heat - this.heat) < 0.005 && this.ctx) return;
    this.heat = heat;
    if (!this.ctx) return;
    const cutoff = 3500 * Math.pow(12000 / 3500, heat);
    this.lowpass.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.8);
    this.updateMaster(0.8);
  }
  setFever(on) { this.fever = on; }
  duck(on) { if (this.ducked !== on) { this.ducked = on; this.updateMaster(0.5); } }

  level() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    let sum = 0;
    const n = Math.min(20, this.bins.length);
    for (let i = 0; i < n; i++) sum += this.bins[i];
    return Math.min(1, sum / n / 190);
  }

  // ---------- スケジューラ ----------
  schedule() {
    const ahead = this.ctx.currentTime + 0.2;
    while (this.nextTime < ahead) {
      const s = this.step % STEPS_PER_BAR;
      const bar = Math.floor(this.step / STEPS_PER_BAR);
      if (s === 0) {
        if (this.pendingBpm !== null) { this.bpm = this.pendingBpm; this.stepSec = 60 / this.bpm / 4; this.delay.delayTime.setValueAtTime(this.stepSec * 3, this.nextTime); this.pendingBpm = null; }
        this.layers = this.layersFor(this.heat);     // 層の切り替えは小節の頭だけ
        this.playBar(this.nextTime, bar);
      }
      this.playStep(this.nextTime, bar, s);
      this.nextTime += this.stepSec;
      this.step += 1;
    }
  }

  chordAt(bar) { return this.chords[bar % this.chords.length]; }

  // 小節単位の音: 薄いパッド(コードの持続音)
  playBar(t, bar) {
    const chord = this.chordAt(bar);
    const barLen = this.stepSec * STEPS_PER_BAR;
    for (const m of chord.notes.slice(0, 4)) {
      for (const det of [-5, 5]) {
        this.tone({ t, freq: mtof(m), type: 'sine', detune: det, dur: barLen * 1.05, gain: 0.045, attack: 0.9, release: 0.9, cutoff: 1800 });
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det * 0.6, dur: barLen * 1.05, gain: 0.022, attack: 1.1, release: 0.9, cutoff: 3200 });
      }
    }
  }

  // 16 分単位の音
  playStep(t, bar, s) {
    const chord = this.chordAt(bar);
    const L = this.layers;
    const offBeat = s % 4 === 2;

    // エレピ風の分散和音(層 1〜): 8 分で上って下りる。小節ごとに形を少し変える
    if (s % 2 === 0) {
      const v = chord.notes;                                   // [root, 3rd, 5th, 7th, 9th]
      const shapes = [[0, 2, 3, 4, 3, 2, 1, 2], [0, 1, 2, 4, 3, 4, 2, 1], [0, 2, 4, 3, 2, 3, 1, 2]];
      const shape = shapes[bar % shapes.length];
      const i = shape[(s / 2) % 8];
      const m = v[i] + (i === 0 ? 0 : 12);
      const g = s % 8 === 0 ? 0.16 : 0.11;
      this.ep(t, mtof(m), g);
    }

    // 旋律(層 2〜): 8 小節のフレーズ。エコーに送る
    if (L >= 2) {
      const pos = (bar * STEPS_PER_BAR + s) % MELODY_LEN;
      const note = MELODY.find((n) => n[0] === pos);
      if (note) {
        const m = this.penta[note[1]] + 12;
        const dur = this.stepSec * note[2] * 0.95;
        this.tone({ t, freq: mtof(m), type: 'triangle', dur, gain: 0.15, attack: 0.02, release: Math.min(0.35, dur * 0.5), cutoff: 2600, toDelay: true });
        this.tone({ t, freq: mtof(m), type: 'sine', detune: 4, dur, gain: 0.07, attack: 0.03, release: Math.min(0.35, dur * 0.5), cutoff: 2600 });
      }
      // ベース: 1 拍目と 3 拍目にルート、4 拍目の裏に 5 度
      if (s === 0 || s === 8) {
        this.tone({ t, freq: mtof(chord.root - 12), type: 'sine', dur: this.stepSec * 7, gain: 0.2, attack: 0.01, release: 0.3, cutoff: 420 });
      } else if (s === 14) {
        this.tone({ t, freq: mtof(chord.root - 12 + 7), type: 'sine', dur: this.stepSec * 2, gain: 0.14, attack: 0.01, release: 0.15, cutoff: 420 });
      }
      // 裏拍の小さなブラシ
      if (offBeat) this.hat(t, 0.028);
    }
  }

  // エレピ風の 1 音: 正弦波に三角波の倍音を少し重ねる。立ち上がりは速く、減衰はゆっくり
  ep(t, freq, gain) {
    this.tone({ t, freq, type: 'sine', dur: this.stepSec * 2.4, gain, attack: 0.004, release: 0.45, cutoff: 3000 });
    this.tone({ t, freq: freq * 2, type: 'triangle', dur: this.stepSec * 1.2, gain: gain * 0.22, attack: 0.004, release: 0.2, cutoff: 5000 });
  }

  // ---------- 楽器 ----------
  tone({ t, freq, type, detune = 0, dur, gain, attack, release, cutoff, toDelay = false }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f); f.connect(g); g.connect(this.lowpass);
    if (toDelay) g.connect(this.delay);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  kick(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g); g.connect(this.drumBus);
    osc.start(t); osc.stop(t + 0.35);
    // FEVER のポンプ: キックのたびに全体を凹ませて戻す(サイドチェインの代わり)。CLASSIC ではしない
    if (this.fever && !(this.calm && this.calm.feverCalm)) {
      this.pump.gain.cancelScheduledValues(t);
      this.pump.gain.setValueAtTime(0.55, t);
      this.pump.gain.linearRampToValueAtTime(1, t + this.stepSec * 3);
    }
  }

  hat(t, gain, open = false) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    const dur = open ? 0.25 : 0.05;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.drumBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(f); f.connect(g); g.connect(this.drumBus);
    src.start(t); src.stop(t + 0.2);
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.4, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g2); g2.connect(this.drumBus); osc.start(t); osc.stop(t + 0.15);
  }
}
