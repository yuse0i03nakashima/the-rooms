// 調整値はここに集める。
export const CONFIG = {
  lives: { max: 3, start: 3 },
  world: { stagesPer: 5 },           // World = 5 Stage。Heart が尽きたら World の先頭から
  score: {
    placeBase: 100,                  // 正しい駒 1 つ = 100 × Chain 倍率
    chainStep: 0.5,                  // Chain 1 つごとに倍率 +0.5
    maxMult: 5,                      // 倍率の上限(Chain 8 で到達)
    clearBonus: 500,
    perfectBonus: 1000,              // 間違いも Hint も無し
    timeParPerCell: 12,              // 目標時間 = N × 12 秒。残り 1 秒ごとに +10
    timePerSecond: 10,
    hintCost: 200,                   // Hint 1 回ごとに Score から引く(0 未満にはしない)
  },
  stars: { perfect: 3, good: 2, clear: 1 },   // good = Hint なしで間違い 1 回以下
  hint: { maxPerStage: 3 },
  autoMark: true,                    // 駒を置いたら、その駒とぶつかるマスに × を自動で付ける
  fx: { scale: 1.0 },
  audio: { masterVolume: 0.35 },
  bgm: { mode: 'synth', synthVolume: 0.24, tonic: 61, bpm: 140, maxLayers: 2 },  // D♭ メジャー、BPM 140。参考 2 曲(128 と 145)の間。進行は music.js の冒頭に根拠
  chat: { minIntervalMs: 2500 },      // ステロペの一言の間隔
  save: { key: 'therooms.v1' },
};
