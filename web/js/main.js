// 画面のつなぎ込み: Game の events を受けて描画・演出・音・ステロペの一言を出す。
import { CONFIG } from './config.js';
import { Game, MARK } from './game.js';
import { Renderer } from './render.js';
import { FX, PALETTE } from './fx.js';
import { Sound, vibrate } from './audio.js';
import { Music } from './music.js';
import { Portrait } from './sterope.js';

const $ = (id) => document.getElementById(id);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const fmt = (n) => n.toLocaleString('en-US');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ステロペの一言。人格の正典(温かく人懐っこい後輩)の範囲で、所属や経歴には触れない
const LINES = {
  start: ['さあ、始めましょう。', '落ち着いて、ひと部屋ずつ。', 'お手伝いしますね。', '今日もよろしくお願いします。'],
  place: ['ええ、そこです。', 'いいですね。', 'その調子です。', 'はい、合っています。'],
  chain: ['冴えていますね。', 'お見事です。', '迷いがありませんね。', 'すごい……。'],
  wrong: ['あら……。', '惜しいです。もう一度見直しましょう。', '大丈夫、落ち着いて。', 'そこは、違うみたいです。'],
  hint: ['ここを見てください。', 'この印のところ、置けるのはひとつだけです。', 'ここに置けますよ。'],
  hintNone: ['もう教えられる分は使い切りました。', 'あとは自分の力で。'],
  clear: ['全部そろいました。', 'お見事です。', 'きれいに収まりましたね。'],
  perfect: ['完璧です。', '一度も迷いませんでしたね。', '誇らしいです。'],
  over: ['今日はここまでにしましょうか。', 'また続きをしましょう。', '休憩も大事です。'],
  idle: ['ゆっくりで大丈夫ですよ。', '焦らなくていいんです。', '行と列と部屋、それぞれひとりずつです。'],
  giveUp: ['別の面にしましょう。', '気分を変えましょうか。'],
  welcome: ['お待ちしていました。', 'いらっしゃいませ。', 'お部屋の支度はできています。'],
};

async function main() {
  const stages = await (await fetch('levels/stages.json')).json();
  const game = new Game(CONFIG, stages, localStorage);
  const fx = new FX($('fx'), CONFIG.fx);
  const sound = new Sound(CONFIG.audio.masterVolume);
  sound.enabled = sound.loadEnabled();
  const bgm = new Music({ volume: CONFIG.bgm.synthVolume, tonic: CONFIG.bgm.tonic, bpm: CONFIG.bgm.bpm });
  bgm.setCalm({ bpm: CONFIG.bgm.bpm, maxLayers: CONFIG.bgm.maxLayers, volume: CONFIG.bgm.synthVolume, feverCalm: true });
  let bgmOn = (() => { try { return localStorage.getItem('therooms.bgm') !== 'off'; } catch { return true; } })();
  bgm.setEnabled(bgmOn && CONFIG.bgm.mode !== 'off');
  const renderer = new Renderer($('board'));
  const portrait = new Portrait($('portrait'), $('bubble'));
  const ensureAudio = () => { if (sound.ensure()) bgm.attach(sound.ctx); };

  let titleShown = true;
  let lastInput = performance.now();
  let lastLine = 0;

  const say = (kind, ms) => {
    const now = performance.now();
    if (now - lastLine < CONFIG.chat.minIntervalMs && kind !== 'start' && kind !== 'clear' && kind !== 'perfect' && kind !== 'over') return;
    lastLine = now;
    portrait.say(pick(LINES[kind]), ms);
  };

  // ---------- 小さな UI 部品 ----------
  const ui = {
    toast(text, ms = 1400) {
      const t = $('toast');
      t.textContent = text; t.hidden = false;
      t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
      clearTimeout(ui._tt); ui._tt = setTimeout(() => { t.hidden = true; }, ms);
    },
    open(html) { $('overlay-card').innerHTML = html; $('overlay').hidden = false; },
    close() { $('overlay').hidden = true; },
    isOpen() { return !$('overlay').hidden; },
  };

  // ---------- HUD ----------
  function renderHud() {
    const st = game.stage;
    if (!st) return;
    $('hud-stage').textContent = `STAGE ${String(st.stage).padStart(2, '0')}`;
    $('hud-world').textContent = `world ${game.worldOf(st.stage)} · ${st.size}×${st.size}`;
    $('hud-score').textContent = fmt(game.run.score + st.score);
    $('hud-chain').textContent = `×${game.mult.toFixed(1)}`;
    $('hud-chain').classList.toggle('hot', st.chain >= 4);
    const lives = $('hud-lives');
    lives.innerHTML = '';
    for (let i = 0; i < CONFIG.lives.max; i++) {
      const s = document.createElement('span');
      s.className = 'heart' + (i < game.run.lives ? '' : ' off');
      s.textContent = '♥';
      lives.appendChild(s);
    }
    const left = CONFIG.hint.maxPerStage - st.hints;
    $('btn-hint-sub').textContent = left > 0 ? `${left} left` : 'none';
    $('btn-hint').disabled = left <= 0 || st.status !== 'play';
  }
  function renderTime() {
    const st = game.stage;
    if (!st || st.status !== 'play') return;
    const elapsed = (performance.now() - st.startedAt) / 1000;
    const par = st.size * CONFIG.score.timeParPerCell;
    $('hud-time').textContent = mmss(elapsed) + (elapsed < par ? ` / ${mmss(par)}` : '');
    $('hud-time').classList.toggle('late', elapsed >= par);
  }
  function redraw() { if (game.stage) renderer.update(game.stage); renderHud(); }

  // ---------- events ----------
  function handle(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'stageStart': onStageStart(ev); break;
        case 'mark': sound.select(); redraw(); break;
        case 'unmark': sound.deselect(); redraw(); break;
        case 'place': onPlace(ev); break;
        case 'wrong': onWrong(ev); break;
        case 'hint': onHint(ev); break;
        case 'hintNone': say('hintNone'); ui.toast(ev.reason === 'limit' ? 'Hint はこの Stage で使い切りました' : '置ける所は残っていません'); break;
        case 'marksCleared': redraw(); sound.deselect(); break;
        case 'stageClear': onStageClear(ev); break;
        case 'stageFailed': ui.toast(`Heart −1`, 1200); sound.fail(); say('giveUp'); portrait.play('worried'); break;
        case 'runOver': onRunOver(ev); break;
        default: break;
      }
    }
  }

  function onStageStart(ev) {
    renderer.build(game.stage.puzzle);
    redraw();
    renderTime();
    document.body.classList.remove('clear');
    say('start');
    portrait.play(ev.stage === 1 ? 'salute' : 'nod');
    const c = $('board').getBoundingClientRect();
    fx.ring(c.left + c.width / 2, c.top + c.height / 2, PALETTE.amber, Math.min(c.width, c.height) / 2);
  }

  function onPlace(ev) {
    redraw();
    renderer.pop(ev.pos);
    const c = renderer.center(ev.pos);
    const color = ev.chain >= 6 ? PALETTE.rose : ev.chain >= 3 ? PALETTE.amber : PALETTE.white;
    fx.burst(c.x, c.y, { color, count: 14 + ev.chain * 3, power: 0.9 + ev.chain * 0.1, size: 3 });
    if (ev.points > 0) fx.floatText(c.x, c.y - 10, `+${fmt(ev.points)}`, { color, size: 16 + Math.min(10, ev.chain * 2) });
    if (ev.chain >= 4) fx.ring(c.x, c.y, color, c.w);
    for (const q of ev.auto) { const a = renderer.center(q); fx.sparks(a.x, a.y, PALETTE.white, 2); }
    sound.remove(ev.chain, Math.min(1, ev.chain / 8));
    vibrate(12);
    if (ev.placed < ev.size) {
      if (ev.chain >= 4 && ev.chain % 2 === 0) { say('chain'); portrait.play('happy'); }
      else if (Math.random() < 0.35) say('place');
    }
  }

  function onWrong(ev) {
    redraw();
    renderer.flashWrong(ev.pos);
    const c = renderer.center(ev.pos);
    fx.burst(c.x, c.y, { color: PALETTE.red, count: 16, power: 1.1, size: 3 });
    fx.shake($('board-wrap'), 6, 260);
    fx.flash('rgba(201,86,110,0.18)');
    sound.invalid();
    vibrate([40, 30, 40]);
    say('wrong');
    portrait.play(ev.lives <= 1 ? 'teary' : 'worried');
    ui.toast(`Heart −1`, 1000);
  }

  function onHint(ev) {
    redraw();
    const c = renderer.center(ev.pos);
    fx.ring(c.x, c.y, PALETTE.amber, c.w * 1.2);
    fx.floatText(c.x, c.y - 20, `−${ev.cost}`, { color: PALETTE.amber, size: 14 });
    sound.hint();
    say('hint');
    portrait.play('think');
  }

  async function onStageClear(ev) {
    redraw();
    document.body.classList.add('clear');
    const c = $('board').getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    fx.freeze(80);
    await sleep(90);
    fx.ring(cx, cy, PALETTE.amber, c.width * 0.7);
    fx.flash('rgba(240,215,138,0.25)');
    fx.fireworks(ev.perfect ? 8 : 4);
    fx.floatText(cx, cy - 20, ev.perfect ? 'PERFECT' : 'CLEAR', { color: ev.perfect ? PALETTE.rose : PALETTE.amber, size: 40, dy: -40, life: 1.6 });
    sound.stageClear();
    if (ev.perfect) sound.perfect();
    if (ev.lifeGain) { sound.lifeGain(); fx.floatText(cx, cy + 30, 'Heart +1', { color: PALETTE.rose, size: 18, dy: -30, life: 1.4 }); }
    vibrate(ev.perfect ? [60, 40, 60, 40, 120] : [40, 30, 60]);
    say(ev.perfect ? 'perfect' : 'clear', 3500);
    portrait.play(ev.perfect ? 'delight' : 'happy');
    await sleep(1300);
    showResult(ev);
  }

  function onRunOver(ev) {
    redraw();
    sound.runOver();
    say('over', 4000);
    portrait.play('teary');
    setTimeout(() => {
      ui.open(`
        <div class="card-title">RUN OVER</div>
        <p class="card-sub">Heart が尽きました。World ${game.worldOf(ev.worldStart)} の先頭(Stage ${ev.worldStart})からやり直せます。</p>
        <div class="rows">
          <div class="row"><span>Run Score</span><b>${fmt(ev.score)}</b></div>
          <div class="row"><span>Best</span><b>${fmt(ev.best)}</b></div>
        </div>
        <div class="card-buttons">
          <button class="btn primary" id="ov-retry">STAGE ${ev.worldStart} から</button>
          <button class="btn" id="ov-title">TITLE</button>
        </div>`);
      $('ov-retry').onclick = () => { ui.close(); handle(game.startStage(ev.worldStart, performance.now())); };
      $('ov-title').onclick = showTitle;
    }, 900);
  }

  function showResult(ev) {
    const stars = '★'.repeat(ev.stars) + '☆'.repeat(3 - ev.stars);
    const rows = [
      ['Pieces', fmt(ev.base)],
      ['Time Bonus', `+${fmt(ev.timeBonus)} <small>(${mmss(ev.elapsed)})</small>`],
      ['Clear Bonus', `+${fmt(CONFIG.score.clearBonus)}`],
      ev.perfect ? ['Perfect', `+${fmt(CONFIG.score.perfectBonus)}`] : null,
      ['Stage Score', `<b>${fmt(ev.stageScore)}</b>` + (ev.stageBestUpdated ? ' <em class="new">NEW BEST</em>' : ` <small>best ${fmt(Math.max(ev.prevBest, ev.stageScore))}</small>`)],
      ['Run Score', fmt(ev.runScore)],
      ev.lifeGain ? ['Heart', '+1'] : null,
      ['Max Chain', `${ev.maxChain}`],
    ].filter(Boolean);
    ui.open(`
      <div class="card-title">${ev.last ? 'ALL CLEAR' : `STAGE ${String(ev.stage).padStart(2, '0')} CLEAR`}</div>
      <div class="stars">${stars}</div>
      <div class="rows">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>
      <div class="card-buttons">
        ${ev.last ? '' : '<button class="btn primary" id="ov-next">NEXT STAGE</button>'}
        <button class="btn" id="ov-title">TITLE</button>
      </div>`);
    if (!ev.last) $('ov-next').onclick = () => { ui.close(); handle(game.nextStage(performance.now())); };
    $('ov-title').onclick = showTitle;
  }

  // ---------- Title / Menu / Records / How to play ----------
  function showTitle() {
    titleShown = true;
    document.body.classList.add('title');
    const p = game.progress;
    const resume = game.resumeStage;
    ui.open(`
      <div class="logo"><span class="logo-main">THE ROOMS</span><span class="logo-sub">屋敷の部屋に、ひとりずつ</span></div>
      <div class="title-stats"><span>Best ${fmt(p.best)}</span><span>★ ${game.totalStars()}</span><span>Stage ${p.stageReached} / ${game.stageCount}</span></div>
      <div class="card-buttons col">
        <button class="btn primary" id="ov-play">${resume > 1 ? `CONTINUE · STAGE ${resume}` : 'START'}</button>
        <button class="btn" id="ov-select">SELECT STAGE</button>
        <button class="btn" id="ov-records">RECORDS</button>
        <button class="btn" id="ov-how">HOW TO PLAY</button>
      </div>`);
    say('welcome', 3000);
    $('ov-play').onclick = () => { startFrom(resume); };
    $('ov-select').onclick = showSelect;
    $('ov-records').onclick = showRecords;
    $('ov-how').onclick = showHow;
  }
  function startFrom(n) {
    ensureAudio();
    titleShown = false;
    document.body.classList.remove('title');
    ui.close();
    if (n !== game.run.stage) { game.run.score = 0; game.run.lives = CONFIG.lives.start; game.run.worldStart = n - ((n - 1) % CONFIG.world.stagesPer); }
    handle(game.startStage(n, performance.now()));
  }
  function showSelect() {
    const p = game.progress;
    const items = [];
    for (let n = 1; n <= Math.min(game.stageCount, p.stageReached); n++) {
      const def = game.stageDef(n);
      const s = p.stars[n] ?? 0;
      items.push(`<button class="sel ${n === game.run.stage ? 'cur' : ''}" data-stage="${n}"><b>${n}</b><small>${def.size}×${def.size}</small><i>${'★'.repeat(s)}</i></button>`);
    }
    ui.open(`
      <div class="card-title">SELECT STAGE</div>
      <p class="card-sub">World の先頭以外から始めると、その World の先頭が Run の起点になります。</p>
      <div class="sel-grid">${items.join('')}</div>
      <div class="card-buttons"><button class="btn" id="ov-back">BACK</button></div>`);
    $('overlay-card').querySelectorAll('[data-stage]').forEach((b) => { b.onclick = () => startFrom(Number(b.dataset.stage)); });
    $('ov-back').onclick = showTitle;
  }
  function showRecords() {
    const p = game.progress;
    const rows = [];
    for (let n = 1; n <= game.stageCount; n++) {
      if (!p.stageBest[n]) continue;
      rows.push(`<div class="row"><span>Stage ${String(n).padStart(2, '0')} <small>${game.stageDef(n).size}×${game.stageDef(n).size}</small></span><span>${'★'.repeat(p.stars[n] ?? 0)}</span><b>${fmt(p.stageBest[n])}</b></div>`);
    }
    ui.open(`
      <div class="card-title">RECORDS</div>
      <div class="rows"><div class="row"><span>Best Run</span><b>${fmt(p.best)}</b></div><div class="row"><span>Stars</span><b>★ ${game.totalStars()}</b></div><div class="row"><span>Clears</span><b>${p.clears}</b></div></div>
      <div class="rows rec">${rows.join('') || '<p class="card-sub">まだ記録がありません。</p>'}</div>
      <div class="card-buttons"><button class="btn" id="ov-back">BACK</button></div>`);
    $('ov-back').onclick = showTitle;
  }
  function showHow() {
    ui.open(`
      <div class="card-title">HOW TO PLAY</div>
      <div class="how">
        <p>盤は N×N で、色の違う N 個の<b>部屋</b>に分かれています。<b>各行・各列・各部屋にひとりずつ</b>、ステロペを置いてください。</p>
        <p>ステロペどうしは<b>隣り合えません</b>(斜めも含む 8 方向)。</p>
        <p>マスをタップすると <b>×</b>(ここには置けない印)、もう一度タップすると<b>駒</b>になります。駒を置いた瞬間に正誤が決まり、間違えると <b>Heart</b> が 1 つ減ります。Heart が尽きると World(5 Stage)の先頭からやり直しです。</p>
        <p><b>Chain</b>: 間違えずに置き続けると倍率が上がります(×1.0 → ×5.0)。間違いと Hint で ×1.0 に戻ります。</p>
        <p><b>Hint</b>: 次に必ず置ける場所を教えます(1 Stage に 3 回まで、Score −200)。<b>Perfect</b>(間違いも Hint も無し)で Bonus と Heart +1。目標時間より早いと Time Bonus。</p>
        <p>駒を置くと、ぶつかるマスに自動で × が付きます(メニューで切れます)。</p>
        <p>面はすべて<b>解がひとつだけ</b>。必ず「ここしかない」場所があります。どの行・列・部屋の候補がひとつか、ある部屋の候補が 1 行に収まっていないか、を探してください。</p>
      </div>
      <div class="card-buttons"><button class="btn" id="ov-back">BACK</button></div>`);
    $('ov-back').onclick = showTitle;
  }
  function showMenu() {
    const st = game.stage;
    ui.open(`
      <div class="card-title">MENU</div>
      <div class="card-buttons col">
        <button class="btn primary" id="ov-resume">RESUME</button>
        <button class="btn" id="ov-auto">AUTO × : ${game.autoMark ? 'ON' : 'OFF'}</button>
        <button class="btn" id="ov-sound">SOUND : ${sound.enabled ? 'ON' : 'OFF'}</button>
        <button class="btn" id="ov-bgm">BGM : ${bgmOn ? 'ON' : 'OFF'}</button>
        <button class="btn" id="ov-clear">CLEAR ALL ×</button>
        <button class="btn danger" id="ov-giveup">GIVE UP <small>Heart −1 · 別の面</small></button>
        <button class="btn" id="ov-title">TITLE</button>
        <button class="btn dim" id="ov-reset">RESET PROGRESS</button>
      </div>`);
    $('ov-resume').onclick = ui.close;
    $('ov-auto').onclick = () => { game.autoMark = !game.autoMark; game.save(); showMenu(); };
    $('ov-sound').onclick = () => { sound.setEnabled(!sound.enabled); showMenu(); };
    $('ov-bgm').onclick = () => { bgmOn = !bgmOn; try { localStorage.setItem('therooms.bgm', bgmOn ? 'on' : 'off'); } catch { /* 無視 */ } bgm.setEnabled(bgmOn); showMenu(); };
    $('ov-clear').onclick = () => { ui.close(); handle(game.clearMarks()); };
    $('ov-giveup').onclick = () => { ui.close(); if (st && st.status === 'play') handle(game.giveUp(performance.now())); };
    $('ov-title').onclick = showTitle;
    let armed = false;
    $('ov-reset').onclick = () => {
      if (!armed) { armed = true; $('ov-reset').textContent = 'もう一度押すと記録を消します'; return; }
      game.resetAll(); ui.close(); showTitle();
    };
  }

  // ---------- 入力 ----------
  $('board').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cell');
    if (!el || ui.isOpen() || !game.stage || game.stage.status !== 'play') return;
    e.preventDefault();
    ensureAudio();
    lastInput = performance.now();
    handle(game.tap([Number(el.dataset.r), Number(el.dataset.c)], performance.now()));
  });
  $('btn-hint').onclick = () => { ensureAudio(); lastInput = performance.now(); handle(game.hint(performance.now())); };
  $('btn-clear').onclick = () => { handle(game.clearMarks()); };
  $('btn-menu').onclick = () => { ensureAudio(); showMenu(); };
  $('overlay').addEventListener('pointerdown', (e) => { if (e.target === $('overlay') && !titleShown && game.stage?.status === 'play') ui.close(); });
  $('portrait').addEventListener('pointerdown', () => { portrait.play(pick(['happy', 'surprise', 'relief', 'nod'])); say('idle'); });

  // ---------- 毎フレーム ----------
  function tick() {
    requestAnimationFrame(tick);
    renderTime();
    const st = game.stage;
    const playing = st && st.status === 'play' && !titleShown;
    if (playing) { bgm.setHeat(Math.min(1, st.chain / 8)); bgm.play(); }
    bgm.duck(ui.isOpen());
    if (playing && !ui.isOpen() && performance.now() - lastInput > 40000) { lastInput = performance.now(); say('idle'); portrait.play('puzzled'); }
  }
  requestAnimationFrame(tick);

  // ---------- 起動 ----------
  if (game.run.stage > 1 || game.progress.stageReached > 1) game.startStage(game.resumeStage);
  else game.startStage(1);
  renderer.build(game.stage.puzzle); redraw();
  showTitle();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') globalThis.__rooms = { game, handle, fx, sound, bgm, portrait };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:12px">${String(e)}</pre>`); });
