// 生成 BGM(音源ファイルを使わず、WebAudio で合成する)。THE ROOMS 用。
//
// ねらい: 「アップテンポで甘いのに、どこかに切なさがある」。参考音源 2 曲を調べた:
//   1. 案山子「真生活」(コード譜と楽曲分析サイト):
//        D♭ メジャー、BPM 128。ほぼ全編 IVmaj7 → III → vi7 → I7 の 4 小節。
//   2. Dyolow「ROCK PAPER SCISSORS!」(NCS。音声を解析 + Hooktheory):
//        C メジャー、BPM 145、四つ打ち、明るい音色(スペクトル重心 2.5 kHz)。
//        サビは IVmaj7 → V → iii7 → II7(V7/ii)。
//   共通点: 先頭が IVmaj7(長 7 度の甘さ)、途中に音階の外の長三和音(III や II7 = 副属和音)が
//   入ってそこが切ない、最後は短 7 の和音か属和音で IV へ戻る、四つ打ちのダンスビート。
//   音そのものは写さず、進行・テンポ・リズムの性格だけを借りて、自分の旋律と音色で作る。
//
// 構成(BPM 140、4 分の 4、8 小節 = 前半が 1. の型、後半が 2. の型):
//   IVmaj7 → III7 → vi7 → I7 → IVmaj7 → V → iii7 → II7
//   層 1(熱 0〜)       四つ打ちのキック、2・4 拍のスネア、8 分のハイハット(時々 16 分の連打)、
//                      滑る 808 風ベース、裏で刻むプラック(フィルタが閉じる音)の和音、薄いパッド
//   層 2(熱 0.25〜)    8 小節の旋律(1 オクターブの中で順次進行が多い)+ 高いベルの分散和音
//
// 時間の管理は「先読みスケジューラ」(Chris Wilson, A Tale of Two Clocks):
//   setInterval で 50ms ごとに起き、AudioContext の時計で 0.2 秒先までの音を予約する。

const STEPS_PER_BAR = 16;

// 音名 → 周波数(A4 = 440)。midi 番号で扱う
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 調(長調の主音の midi 番号。C4 = 60)と BPM は設定で変えられる。
// コード進行は主音からの半音で持つ(III7 や II7 のように、音階に無い音を含むため)
const PROGRESSION = [
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 4, kind: '7' },      // III7   (切ない: 音階の外の長 3 度)
  { degree: 9, kind: 'm7' },     // vi7
  { degree: 0, kind: '7' },      // I7     (属七。IV へ戻る甘さ)
  { degree: 5, kind: 'maj7' },   // IVmaj7
  { degree: 7, kind: 'maj' },    // V
  { degree: 4, kind: 'm7' },     // iii7
  { degree: 2, kind: '7' },      // II7    (V7/ii。ここも切ない)
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
//   参考曲の作り(5 度から主音へ音階を下る 1 小節のフック、同じ音を 16 分 2 つで刻む、頭を 16 分 1 つ遅らせる、
//   音域は 5 度ぶん、4 小節目だけ上り坂で答える)に沿って書いた。奇数小節は同じフック。2 小節目は III7 の根音に移して持ち上げ、
//   6 小節目は終わりを V の 3 度に落として落ち着かせず、4・8 小節目は上り坂で答えて次の小節の頭へつなぐ
const MELODY = [
  // 1 小節目 IVmaj7: フック
  [1, 7, 1], [2, 7, 1], [3, 5, 1], [4, 4, 1], [5, 4, 1], [6, 2, 2], [9, 4, 1], [10, 4, 1], [11, 2, 1], [12, 0, 1], [13, 0, 3],
  // 2 小節目 III7: フックを根音に移して持ち上げる(8 = 音階の外)
  [17, 11, 1], [18, 11, 1], [19, 9, 1], [20, 8, 1], [21, 8, 1], [22, 6, 2], [25, 8, 1], [26, 8, 1], [27, 6, 1], [28, 4, 1], [29, 4, 3],
  // 3 小節目 vi7: フック
  [33, 7, 1], [34, 7, 1], [35, 5, 1], [36, 4, 1], [37, 4, 1], [38, 2, 2], [41, 4, 1], [42, 4, 1], [43, 2, 1], [44, 0, 1], [45, 0, 3],
  // 4 小節目 I7: 上り坂の答え。10(短 7 度)で IV へ引っ張る
  [48, 0, 1], [49, 2, 1], [50, 4, 2], [52, 5, 2], [54, 7, 2], [56, 10, 4], [60, 7, 2], [62, 5, 2],
  // 5 小節目 IVmaj7: フック
  [65, 7, 1], [66, 7, 1], [67, 5, 1], [68, 4, 1], [69, 4, 1], [70, 2, 2], [73, 4, 1], [74, 4, 1], [75, 2, 1], [76, 0, 1], [77, 0, 3],
  // 6 小節目 V: フック。終わりだけ 3 度(-1)に落として落ち着かせない
  [81, 7, 1], [82, 7, 1], [83, 5, 1], [84, 4, 1], [85, 4, 1], [86, 2, 2], [89, 4, 1], [90, 4, 1], [91, 2, 1], [92, -1, 1], [93, -1, 3],
  // 7 小節目 iii7: フック
  [97, 7, 1], [98, 7, 1], [99, 5, 1], [100, 4, 1], [101, 4, 1], [102, 2, 2], [105, 4, 1], [106, 4, 1], [107, 2, 1], [108, 0, 1], [109, 0, 3],
  // 8 小節目 II7: 上り坂の答え。6(音階の外)で止めて、次の 7 へ半音で解決
  [112, 2, 1], [113, 4, 1], [114, 6, 2], [116, 9, 2], [118, 12, 2], [120, 9, 2], [122, 6, 4],
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
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 6500; this.lowpass.Q.value = 0.8;
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
    const cutoff = 6500 * Math.pow(14000 / 6500, heat);
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
        this.tone({ t, freq: mtof(m + 12), type: 'triangle', detune: det, dur: barLen * 1.02, gain: 0.028, attack: 0.3, release: 0.5, cutoff: 2800 });
      }
    }
  }

  // 16 分単位の音
  playStep(t, bar, s) {
    const chord = this.chordAt(bar);
    const L = this.layers;
    const v = chord.notes;

    // ドラム(層 1〜): 四つ打ち、2・4 拍にスネア、8 分のハイハット。2 小節に 1 回、最後に 16 分の連打
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    const roll = bar % 2 === 1 && s >= 13;
    if (s % 2 === 0 || roll) this.hat(t, roll ? 0.07 : s % 4 === 2 ? 0.1 : 0.06, s === 14 && !roll);

    // 808 風のベース(層 1〜): 音の頭で上から滑り込む。1 拍目は長く、4 拍目の裏でオクターブ上
    const bassAt = { 0: 6, 6: 2, 8: 4, 12: 2, 14: 2 };
    if (bassAt[s]) {
      const m = chord.root - 12 + (s === 14 ? 12 : s === 12 ? 7 : 0);
      this.bass808(t, mtof(m), this.stepSec * bassAt[s], s === 0 ? 1.5 : 1.12);
    }

    // プラックの和音(層 1〜): 裏で刻むシンコペーション(16 分の 0・3・6・10・12・14)
    const stabs = { 0: 0.13, 3: 0.1, 6: 0.12, 10: 0.1, 12: 0.08, 14: 0.11 };
    if (stabs[s]) {
      for (const [i, m] of v.entries()) this.pluck(t + i * 0.005, mtof(m + 12), stabs[s] * (i === 0 ? 0.6 : 1));
    }

    {
      // 旋律: 8 小節のフレーズ(曲の顔なので層 1 から)。エコーに送る
      const pos = (bar * STEPS_PER_BAR + s) % MELODY_LEN;
      const note = MELODY.find((n) => n[0] === pos);
      if (note) {
        const m = this.penta[0] + note[1];
        const dur = this.stepSec * note[2] * 0.9;
        const rel = Math.min(0.12, dur * 0.35);
        this.tone({ t, freq: mtof(m), type: 'sawtooth', detune: -8, dur, gain: 0.075, attack: 0.004, release: rel, cutoff: 3000, toDelay: true });
        this.tone({ t, freq: mtof(m), type: 'sawtooth', detune: 8, dur, gain: 0.075, attack: 0.004, release: rel, cutoff: 3000 });
        this.tone({ t, freq: mtof(m), type: 'triangle', dur, gain: 0.1, attack: 0.004, release: rel, cutoff: 5000 });
      }
      // 高いベル(層 2 から。16 分の 1・5・9・13 に和音の音を上から順に)
      if (L >= 2 && s % 4 === 1) {
        const m = v[(3 - Math.floor(s / 4)) % v.length] + 24;
        this.tone({ t, freq: mtof(m), type: 'sine', dur: this.stepSec * 1.6, gain: 0.055, attack: 0.002, release: 0.14, cutoff: 9000, toDelay: true });
      }
    }
  }

  // プラック: のこぎり波のフィルタを一気に閉じる(明るい立ち上がり、短い余韻)
  pluck(t, freq, gain) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + this.stepSec * 1.6);
    osc.connect(f); f.connect(g); g.connect(this.lowpass);
    osc.start(t); osc.stop(t + this.stepSec * 1.7);
  }

  // 808 風ベース: 正弦波を上から滑り込ませ、少し歪ませて倍音を足す
  bass808(t, freq, dur, slide) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * slide, t); osc.frequency.exponentialRampToValueAtTime(freq, t + 0.07);
    const shaper = ctx.createWaveShaper(); shaper.curve = this.softCurve ?? (this.softCurve = makeSoftCurve());
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    g.gain.setValueAtTime(0.5, t + Math.max(0.01, dur - 0.08)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const out = ctx.createGain(); out.gain.value = 0.42;
    osc.connect(g); g.connect(shaper); shaper.connect(out); out.connect(this.drumBus);
    osc.start(t); osc.stop(t + dur + 0.05);
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

// やわらかい歪み(tanh)。808 風ベースの倍音用
function makeSoftCurve() {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
  return curve;
}
