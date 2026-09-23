// M2：声に出すステップ（4-1）＋ 意味理解・構造把握・空欄補充・語順並べ替え（4-2〜4-5）で10文を回す
import { loadData } from './data.js';
import { Voice } from './audio.js';
import { runSpeak } from './speak.js';
import { runMeaning, runStructureA, runStructureB, runCloze, runOrder } from './steps.js';
import { sttSupported } from './stt.js';
import { addEvent, putSession, allSessions, eventsOf } from './db.js';

const RETRY_LIMIT = 5;      // 段階1のやり直し上限（まとめ 10-2）
const REQUEUE_LIMIT = 15;   // セッション内反復の上限（2-3）
const REQUEUE_GAP = 3;      // 再出題までに挟む文の数（2-3：直後に連続させない）

const DEFAULTS = { voice: 'male', speed: 'normal', autoJa: true, echo: true, sound: true, haptics: true, theme: 'light', size: 'l' };
const loadSettings = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('eigo-settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
const saveSettings = s => { try { localStorage.setItem('eigo-settings', JSON.stringify(s)); } catch (e) { /* 無視 */ } };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIRST_LABEL = { ok: '一発OK', ok_yure: '一発OK（ゆれ）', retry_ok: 'やり直して言えた', ng: '言えなかった' };
const FIRST_CLASS = { ok: 'ok', ok_yure: 'near', retry_ok: 'mid', ng: 'ng' };
const STEP_LABEL = { meaning: '単語の意味', structureA: '文のかたち', structureB: '意味の取り方', cloze: '空欄', order: '語順' };

// 画面のすみのボタンはアイコンにする（13-7）。読み上げ用の名前は aria-label で持つ
const ICON = {
  records: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M4 6h16M4 12h16M4 18h10"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="s" cx="12" cy="12" r="3.2"/><path class="s" d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M15 5l-7 7 7 7"/></svg>',
  quit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M6 6l12 12M18 6 6 18"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M12 4v10M8 11l4 4 4-4M5 19h14"/></svg>',
};
const iconBtn = (act, name, kind = act) =>
  `<button class="icon-btn" data-act="${act}" aria-label="${name}" title="${name}">${ICON[kind]}</button>`;

const app = document.getElementById('app');
let settings = loadSettings();
let data = null;
const voice = new Voice(() => settings);

function applyLook() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.size = settings.size;
}

/** その文で行えるステップ（データがあるものだけ。まとめ 2-1 の新規の流れの順） */
function stepsOf(sid) {
  const has = {
    meaning: (data.words[sid] || []).length > 0,
    structureA: (data.structure[sid] || []).some(r => r.label),
    structureB: !!data.structureChoice[sid],
    cloze: !!data.cloze[sid],
    order: (data.order[sid] || []).length > 0,
  };
  return ['meaning', 'structureA', 'structureB', 'cloze', 'order'].filter(k => has[k]);
}

function runStep(key, root, S, log) {
  const ctx = { sentence: S, voice, settings, log };
  if (key === 'meaning') return runMeaning(root, { ...ctx, words: data.words[S.id] || [] });
  if (key === 'structureA') return runStructureA(root, { ...ctx, rows: data.structure[S.id] || [] });
  if (key === 'structureB') return runStructureB(root, { ...ctx, choice: data.structureChoice[S.id] });
  if (key === 'cloze') return runCloze(root, { ...ctx, cloze: data.cloze[S.id], orderWords: (data.order[S.id] || []).filter(r => r.extra !== 1) });
  if (key === 'order') return runOrder(root, { ...ctx, rows: data.order[S.id] || [] });
  return Promise.resolve({ wrong: 0 });
}

// ---------------- ホーム ----------------
async function home() {
  applyLook();
  const sessions = (await allSessions()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = {};
  for (const ss of sessions) for (const [sid, it] of Object.entries(ss.items || {})) if (!latest[sid]) latest[sid] = it.first;
  const files = await voice.hasFiles(data.sentences[0].id);

  app.innerHTML = `
    <header class="top">${iconBtn('records', '記録')}<h1>暗唱トレーニング</h1>${iconBtn('settings', '設定')}</header>
    <main class="home">
      <button class="btn primary big" data-act="start-full">${data.sentences.length}文を練習する</button>
      <button class="btn" data-act="start-speak">暗唱だけにする（声に出すところまで）</button>
      ${sttSupported() ? '' : '<p class="notice">この端末のブラウザは音声認識に対応していません。自分で判定する形で進みます。</p>'}
      ${files ? '' : '<p class="notice">音声ファイルがまだ置かれていないため、ブラウザの読み上げで代用しています。</p>'}
      <h2 class="section-title">前回の結果</h2>
      <ol class="slist">
        ${data.sentences.map(s => `
          <li><span class="sid">${s.id}</span><span class="sja">${esc(s.ja)}</span>
          <span class="badge ${FIRST_CLASS[latest[s.id]] || ''}">${latest[s.id] ? FIRST_LABEL[latest[s.id]] : '未実施'}</span></li>`).join('')}
      </ol>
    </main>`;
  app.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const ids = data.sentences.map(s => s.id);
    if (b.dataset.act === 'start-full') session(ids, 'full');
    if (b.dataset.act === 'start-speak') session(ids, 'speak');
    if (b.dataset.act === 'settings') settingsView();
    if (b.dataset.act === 'records') records();
  };
}

// ---------------- 設定（本人が変えられるもの。まとめ 10-1） ----------------
function settingsView() {
  const opt = (key, pairs) => `<div class="segs wide" role="group">${pairs.map(([v, l]) =>
    `<button class="seg ${settings[key] === v ? 'on' : ''}" data-key="${key}" data-val="${v}" aria-pressed="${settings[key] === v}">${l}</button>`).join('')}</div>`;
  const onoff = [[true, 'ON'], [false, 'OFF']];
  app.innerHTML = `
    <header class="top">${iconBtn('back', '戻る')}<h1>設定</h1><span></span></header>
    <main class="settings">
      <label>声</label>${opt('voice', [['male', '男性'], ['female', '女性']])}
      <label>英語の速さ</label>${opt('speed', [['normal', 'ふつう'], ['slow', 'ゆっくり'], ['fast', 'はやい']])}
      <label>日本語の自動読み上げ</label>${opt('autoJa', onoff)}
      <label>正解したあとに英文を読む</label>${opt('echo', onoff)}
      <label>効果音</label>${opt('sound', onoff)}
      <label>振動</label>${opt('haptics', onoff)}
      <label>画面</label>${opt('theme', [['light', 'ライト'], ['dark', 'ダーク']])}
      <label>文字の大きさ</label>${opt('size', [['l', '大'], ['m', '中'], ['s', '小']])}
    </main>`;
  app.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'back') return home();
    if (b.dataset.key) {
      const raw = b.dataset.val;
      settings[b.dataset.key] = raw === 'true' ? true : raw === 'false' ? false : raw;
      saveSettings(settings); applyLook(); settingsView();
    }
  };
}

// ---------------- セッション ----------------
async function session(ids, mode) {
  const id = new Date().toISOString();
  const ss = { id, startedAt: id, mode, items: {}, done: false };
  const queue = ids.map(sid => ({ sid, appearance: 1, steps: mode === 'full' ? stepsOf(sid) : [] }));
  let stop = false, quit;
  const quitted = new Promise(r => { quit = r; });     // 中断したときに、待っている画面を終わらせる

  while (queue.length && !stop) {
    const item = queue.shift();
    const S = data.byId[item.sid];
    const rest = new Set([item.sid, ...queue.map(q => q.sid)]).size;
    app.innerHTML = `
      <header class="top">${iconBtn('quit', '中断する')}
        <p class="progress">${item.appearance > 1 ? 'もう一度　' : ''}残り ${rest} 文</p><span class="sid">${S.id}</span></header>
      <main id="step"></main>`;
    app.onclick = e => {
      const b = e.target.closest('[data-act="quit"]');
      if (b && confirm('中断してホームに戻りますか？ここまでの記録は残ります。')) { stop = true; voice.stop(); quit(null); home(); }
    };
    const el = document.getElementById('step');
    const log = ev => addEvent({ session: id, sid: S.id, appearance: item.appearance, t: new Date().toISOString(), ...ev });
    const res = await Promise.race([quitted, runSpeak(el, {
      sentence: S, voice, settings, mishear: data.mishear,
      extraAnswers: data.patterns[S.id] || [], retryLimit: RETRY_LIMIT, log,
    })]);
    if (stop || !res) break;

    // 声に出すステップのあと、残りのステップを順に行う（2-1）
    const wrongSteps = [], wrongCount = {};
    for (const key of item.steps) {
      const r = await Promise.race([quitted, runStep(key, el, S, log)]);
      if (stop || !r) break;
      wrongCount[key] = r.wrong;
      if (r.wrong > 0) wrongSteps.push(key);
    }
    if (stop) break;

    const it = ss.items[S.id] || (ss.items[S.id] = { first: res.first, appearances: 0, oneShotLater: false, wrong: wrongCount });
    it.appearances = item.appearance;
    const oneShot = res.first === 'ok' || res.first === 'ok_yure';
    if (item.appearance > 1 && oneShot && !wrongSteps.length) it.oneShotLater = true;
    // 一発OKでなかった文・「またあとで」の文・誤答したステップがある文は、他の文を挟んでもう一度（まとめ 2-3）
    if ((!oneShot || res.again || wrongSteps.length) && item.appearance < REQUEUE_LIMIT) {
      queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, { sid: S.id, appearance: item.appearance + 1, steps: wrongSteps });
    }
    await putSession(ss);
  }
  if (stop) { await putSession(ss); return; }
  ss.done = true; ss.endedAt = new Date().toISOString();
  await putSession(ss);
  summary(ss);
}

// ---------------- 結果 ----------------
function summary(ss) {
  const items = Object.entries(ss.items);
  const count = k => items.filter(([, it]) => it.first === k).length;
  const wrongLine = it => Object.entries(it.wrong || {}).filter(([, n]) => n > 0)
    .map(([k, n]) => `${STEP_LABEL[k]} ${n}`).join('　');
  app.innerHTML = `
    <header class="top"><span></span><h1>おつかれさま</h1><span></span></header>
    <main class="summary">
      <div class="stats">
        <div><b>${count('ok') + count('ok_yure')}</b><span>一発OK</span></div>
        <div><b>${count('retry_ok')}</b><span>やり直して</span></div>
        <div><b>${count('ng')}</b><span>言えなかった</span></div>
      </div>
      <ol class="slist">
        ${items.map(([sid, it]) => `<li><span class="sid">${sid}</span><span class="sja">${esc(data.byId[sid].en)}</span>
          <span class="badge ${FIRST_CLASS[it.first]}">${FIRST_LABEL[it.first]}</span>
          ${it.appearances > 1 ? `<span class="rep">${it.appearances}回目${it.oneShotLater ? 'で一発OK' : 'まで'}</span>` : ''}
          ${wrongLine(it) ? `<span class="rep">誤答　${esc(wrongLine(it))}</span>` : ''}</li>`).join('')}
      </ol>
      <div class="pair">
        <button class="btn" data-act="csv">CSVで保存</button>
        <button class="btn primary" data-act="home">ホームへ</button>
      </div>
    </main>`;
  app.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'home') home();
    if (b.dataset.act === 'csv') downloadCsv(ss.id, await eventsOf(ss.id));
  };
}

// ---------------- 記録（中断したセッションも保存できる） ----------------
async function records() {
  const sessions = (await allSessions()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const when = t => t.slice(0, 16).replace('T', ' ').replace(/-/g, '/');
  app.innerHTML = `
    <header class="top">${iconBtn('back', '戻る')}<h1>記録</h1><span></span></header>
    <main class="home">
      ${sessions.length ? '' : '<p class="notice">まだ記録がありません。</p>'}
      <ol class="slist">
        ${sessions.map(ss => `<li><span class="sid">${when(ss.startedAt)}</span>
          <span class="sja">${Object.keys(ss.items || {}).length}文　${ss.mode === 'speak' ? '暗唱だけ' : 'フルコース'}${ss.done ? '' : '（中断）'}</span>
          <span class="rep"><button class="icon-btn inline" data-csv="${esc(ss.id)}" aria-label="CSVで保存" title="CSVで保存">${ICON.save}</button></span></li>`).join('')}
      </ol>
    </main>`;
  app.onclick = async e => {
    const b = e.target.closest('[data-act],[data-csv]'); if (!b) return;
    if (b.dataset.act === 'back') return home();
    if (b.dataset.csv) downloadCsv(b.dataset.csv, await eventsOf(b.dataset.csv));
  };
}

function downloadCsv(id, evs) {
  const head = ['t', 'sid', 'appearance', 'type', 'attempt', 'check', 'match', 'heard', 'ops', 'pieces', 'error', 'waitMs', 'restarts', 'first', 'again', 'wid', 'word', 'label', 'wrong'];
  const cell = v => `"${String(Array.isArray(v) ? v.join(' | ') : (v ?? '')).replace(/"/g, '""')}"`;
  const csv = '﻿' + [head.join(','), ...evs.map(e => head.map(h => cell(e[h])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `session-${id.slice(0, 19).replace(/[-:T]/g, '')}.csv`;
  // Android では、画面に置いてから押さないと保存されないことがある
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 60000);
}

// ---------------- 起動 ----------------
(async () => {
  applyLook();
  try {
    data = await loadData();
    home();
  } catch (e) {
    app.innerHTML = `<main class="home"><p class="notice">${esc(e.message)}</p>
      <p class="notice">data フォルダに tools/build_data.py で作った JSON があるか確認してください。</p></main>`;
  }
})();
