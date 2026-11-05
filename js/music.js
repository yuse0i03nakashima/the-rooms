// 生成 BGM(音源ファイルを使わず、WebAudio で合成する)。THE ROOMS 用。
//
// ねらい: 「アップテンポで甘いのに、どこかに切なさがある」。
//   参考にした曲(案山子「真生活」)をコード譜と楽曲分析サイトで調べた結果:
//     調 D♭ メジャー(相対調 B♭ マイナー)、BPM 128、ほぼ全編が 4 小節の繰り返し
//       IVmaj7 → III → vi7 → I7   (G♭maj7 → F → B♭m7 → D♭7)
//     途中で IV → V → vi7 に変わる所がある。
//   「切なさ」は III(長三和音のドミナント)から vi7 へ落ちる所、
//   「甘さ」は IVmaj7 の長 7 度と、I7(属七)が IV へ戻る所から来る。
//   音そのものは写さず、この進行・テンポ・リズムの性格だけを借りて、自分の旋律と音色で作る。
//
// 構成(BPM 128、4 分の 4、8 小節 = 上の 4 小節 ×2。後半は III の代わりに V):
//   層 1(熱 0〜)       四つ打ちのキックと 8 分のハイハット、2・4 拍のスネア、8 分のベース、
//                      裏で刻むエレピの和音(16 分のシンコペーション)、薄いパッド
//   層 2(熱 0.25〜)    8 小節の旋律 + 高い所のきらきらした分散和音
//
// 時間の管理は「先読みスケジューラ」(Chris Wilson, A Tale of Two Clocks):
//   setInterval で 50ms ごとに起き、AudioContext の時計で 0.2 秒先までの音を予約する。

const STEPS_PER_BAR = 16;

// 音名 → 周波数(A4 = 440)。midi 番号で扱う
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 調(長調の主音の midi 番号。C4 = 60)と BPM は設定で変えられる。
// コード進行は主音からの半音で持つ(III の長三和音のように、音階に無い音も使うため)
const PROGRESSION = [
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 4, kind: 'maj' },    // III   (長三和音。ここが切ない)
  { degree: 9, kind: 'm7' },     // vi7
  { degree: 0, kind: '7' },      // I7    (属七。IV へ戻る甘さ)
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 7, kind: 'maj' },    // V
  { degree: 9, kind: 'm7' },     // vi7
  { degree: 0, kind: '7' },      // I7
];
const INTERVALS = { maj7: [0, 4, 7, 11], maj: [0, 4, 7, 12], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10] };

function buildChords(tonic) {
  return PROGRESSION.map(({ degree, kind }) => {
    const root = tonic - 12 + degree;                  // 主音の 1 オクターブ下から
    return { root, notes: INTERVALS[kind].map((i) => root + i) };
  });
}
// 旋律の基準音(主音の 1 オクターブ上)。旋律は主音からの半音で書く
function buildPenta(tonic) { return [tonic + 12]; }
// 旋律: [8 小節通しの 16 分の位置, 主音からの半音, 長さ(16 分の数)]
//   III の小節で 8(長 3 度 = 音階に無い音)を長く置いて切なさを出す。I7 では 10(短 7 度)
const MELODY = [
  [0, 9, 2], [2, 11, 2], [4, 12, 2], [8, 16, 4], [12, 14, 2],
  [16, 8, 4], [20, 11, 2], [22, 12, 2], [24, 9, 6],
  [32, 9, 2], [34, 12, 2], [36, 16, 4], [40, 14, 2], [42, 12, 2], [44, 9, 4],
  [48, 7, 4], [52, 10, 2], [54, 9, 2], [56, 7, 6],
  [64, 9, 2], [66, 11, 2], [68, 12, 2], [70, 14, 2], [72, 16, 6],
  [80, 19, 4], [84, 16, 2], [86, 14, 2], [88, 12, 6],
  [96, 9, 2], [98, 12, 2], [100, 16, 4], [104, 17, 2], [106, 16, 2], [108, 14, 4],
  [112, 12, 4], [116, 10, 2], [118, 9, 2], [120, 7, 6],
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
    for (const m of chord.notes) {
      for (const det of [-6, 6]) {
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det, dur: barLen * 1.02, gain: 0.03, attack: 0.4, release: 0.5, cutoff: 2600 });
      }
    }
  }

  // 16 分単位の音
  playStep(t, bar, s) {
    const chord = this.chordAt(bar);
    const L = this.layers;
    const v = chord.notes;

    // ドラム(層 1〜): 四つ打ち、2・4 拍にスネア、8 分のハイハット(4 拍目の裏は開く)
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.11 : 0.06, s === 14);
    if (s % 4 === 3 && bar % 2 === 1) this.hat(t, 0.035);

    // ベース(層 1〜): 8 分でルート。4 拍目の裏で 1 オクターブ上、小節の最後で次の和音へ動く
    if (s % 2 === 0) {
      const m = chord.root - 12 + (s === 14 ? 12 : s === 6 ? 7 : 0);
      this.tone({ t, freq: mtof(m), type: 'sawtooth', dur: this.stepSec * 1.7, gain: 0.2, attack: 0.004, release: 0.06, cutoff: 650 + this.heat * 500 });
    }

    // エレピの和音(層 1〜): 裏で刻むシンコペーション(16 分の 0・3・6・10・12・14)
    const stabs = { 0: 0.14, 3: 0.1, 6: 0.12, 10: 0.1, 12: 0.08, 14: 0.11 };
    if (stabs[s]) {
      for (const [i, m] of v.entries()) this.ep(t + i * 0.006, mtof(m + 12), stabs[s] * (i === 0 ? 0.7 : 1));
    }

    if (L >= 2) {
      // 旋律: 8 小節のフレーズ。エコーに送る
      const pos = (bar * STEPS_PER_BAR + s) % MELODY_LEN;
      const note = MELODY.find((n) => n[0] === pos);
      if (note) {
        const m = this.penta[0] + note[1];
        const dur = this.stepSec * note[2] * 0.92;
        this.tone({ t, freq: mtof(m), type: 'square', dur, gain: 0.11, attack: 0.008, release: Math.min(0.2, dur * 0.4), cutoff: 2400, toDelay: true });
        this.tone({ t, freq: mtof(m), type: 'triangle', detune: 5, dur, gain: 0.1, attack: 0.01, release: Math.min(0.2, dur * 0.4), cutoff: 3600 });
      }
      // 高い所のきらきら(16 分の 1・5・9・13 に和音の音を上から)
      if (s % 4 === 1) {
        const m = v[(3 - Math.floor(s / 4)) % v.length] + 24;
        this.tone({ t, freq: mtof(m), type: 'sine', dur: this.stepSec * 1.5, gain: 0.05, attack: 0.003, release: 0.12, cutoff: 8000, toDelay: true });
      }
    }
  }

  // エレピ風の 1 音: 正弦波に三角波の倍音を少し重ねる。立ち上がりは速く、短めに切る
  ep(t, freq, gain) {
    this.tone({ t, freq, type: 'sine', dur: this.stepSec * 1.6, gain, attack: 0.003, release: 0.18, cutoff: 3200 });
    this.tone({ t, freq: freq * 2, type: 'triangle', dur: this.stepSec * 0.9, gain: gain * 0.25, attack: 0.003, release: 0.1, cutoff: 5200 });
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
