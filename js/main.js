// 画面の進行：ホーム・今日の学習・自由に練習・結果・記録・設定
//   今日の学習 … 段方式のスケジュール（まとめ 2-1・2-2）に沿って出題し、段と次の出題日を更新する
//   自由に練習 … 10文を全部出す。段は変えない（3章の追加学習の簡易版）
import { loadData } from './data.js';
import { Voice } from './audio.js';
import { runSpeak } from './speak.js';
import { runMeaning, runStructureA, runStructureB, runCloze, runOrder, MARK } from './steps.js';
import { sttSupported } from './stt.js';
import { addEvent, putSession, allSessions, eventsOf, allCards, putCard } from './db.js';
import { studyDay, daysBetween, review, stepsFor, laterSteps, buildToday, mastery, MASTERY } from './schedule.js';

const RETRY_LIMIT = 5;      // 段階1のやり直し上限（まとめ 10-2）
const REQUEUE_LIMIT = 6;    // セッション内反復の上限（2-3）
const REQUEUE_GAP = 3;      // 再出題までに挟む文の数（2-3：直後に連続させない）
const LATE_FROM = 4;        // 4回目以降は、暗唱と語順並べ替えだけにする（2-3）

const DEFAULTS = { voice: 'male', speed: 'normal', autoJa: true, echo: true, sound: true, haptics: true, theme: 'light', size: 'l' };
const loadSettings = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('eigo-settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
const saveSettings = s => { try { localStorage.setItem('eigo-settings', JSON.stringify(s)); } catch (e) { /* 無視 */ } };

// 確認用：URL に ?day=3 と付けると、3日後として動く（段の動きを、日数を待たずに確かめるため。18-1）
const DAY_OFFSET = Number(new URLSearchParams(location.search).get('day')) || 0;
const today = () => studyDay(new Date(), DAY_OFFSET);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIRST_LABEL = { ok: '一発OK', ok_yure: '一発OK（ゆれ）', retry_ok: 'やり直して言えた', ng: '言えなかった' };
const FIRST_CLASS = { ok: 'ok', ok_yure: 'near', retry_ok: 'mid', ng: 'ng' };
const MASTERY_CLASS = { perfect: 'ok', good: 'ok', close: 'mid', again: 'ng' };
const STEP_LABEL = { meaning: '単語の意味', structureA: '文のかたち', structureB: '意味の取り方', cloze: '空欄', order: '語順' };
const KIND_LABEL = { daily: '今日の学習', full: '自由に練習（全ステップ）', speak: '自由に練習（暗唱だけ）' };

// 画面のすみのボタンはアイコンにする（13-7）。読み上げ用の名前は aria-label で持つ
const ICON = {
  records: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="s" cx="12" cy="12" r="8.4"/><path class="s" d="M12 7.4V12l3.4 2.2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M15 5l-7 7 7 7"/></svg>',
  quit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M6 6l12 12M18 6 6 18"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M12 4v10M8 11l4 4 4-4M5 19h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M8 5.5l10 6.5-10 6.5z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect class="s" x="9" y="3" width="6" height="11" rx="3"/><path class="s" d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/></svg>',
  steps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="s" d="M5 7h14M5 12h14M5 17h9"/></svg>',
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

// ---------------- ホーム（13-2：「今日の学習」を主役にする） ----------------
async function home() {
  applyLook();
  const ids = data.sentences.map(s => s.id);
  const cards = await allCards();
  const plan = buildToday(ids, cards, today());
  const files = await voice.hasFiles(ids[0]);
  const rest = plan.due.length + plan.fresh.length;

  // ボタン自体の見た目で、今日の状態を表す（13-7）
  let main;
  if (rest > 0) {
    const parts = [plan.due.length ? `復習 ${plan.due.length}文` : '', plan.fresh.length ? `新規 ${plan.fresh.length}文` : ''].filter(Boolean).join('・');
    main = `<button class="btn primary big menu-btn" data-act="today">
        ${ICON.play}<span><b>${plan.doneToday ? 'つづきから' : '今日の学習'}</b><small>${plan.doneToday ? `残り ${rest}文（${parts}）` : `${parts}　約${plan.minutes}分`}</small></span></button>`;
  } else {
    const msg = plan.doneToday ? '今日の分は終わりました' : (plan.untouched ? '今日はここまでです' : '今日の出題はありません');
    main = `<div class="btn big menu-btn done" aria-live="polite">${MARK}<span><b>${msg}</b><small>また明日、つづきをやりましょう</small></span></div>`;
  }

  app.innerHTML = `
    <header class="top">${iconBtn('records', '記録')}<h1>暗唱トレーニング</h1>${iconBtn('settings', '設定')}</header>
    <main class="home menu">
      ${main}
      <p class="menu-label">自由に練習<small>（段は変わりません）</small></p>
      <div class="pair">
        <button class="btn sub-btn" data-act="start-full">${ICON.steps}<span>全ステップ</span></button>
        <button class="btn sub-btn" data-act="start-speak">${ICON.mic}<span>暗唱だけ</span></button>
      </div>
      ${DAY_OFFSET ? `<p class="notice">確認用：${DAY_OFFSET}日後（${today()}）として動いています。</p>` : ''}
      ${sttSupported() ? '' : '<p class="notice">この端末のブラウザは音声認識に対応していません。自分で判定する形で進みます。</p>'}
      ${files ? '' : '<p class="notice">音声ファイルがまだ置かれていないため、ブラウザの読み上げで代用しています。</p>'}
    </main>`;
  app.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'today') {
      // 期日が来た文（段の低い順）→ 新規（文IDの順）の順に出す（2-2）
      const list = [...plan.due.map(sid => ({ sid, stage: cards[sid].stage })), ...plan.fresh.map(sid => ({ sid, stage: 0 }))];
      session(list, 'daily', cards);
    }
    if (act === 'start-full') session(ids.map(sid => ({ sid })), 'full', cards);
    if (act === 'start-speak') session(ids.map(sid => ({ sid })), 'speak', cards);
    if (act === 'settings') settingsView();
    if (act === 'records') records();
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
      <label>英語の速さ</label>${opt('speed', [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']])}
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
/**
 * list：出題する文 [{ sid, stage }]。stage は今日の学習のときだけ使う（0＝新規）
 * kind：'daily'（今日の学習）| 'full'・'speak'（自由に練習。段は変えない）
 */
async function session(list, kind, cards) {
  const id = new Date().toISOString();
  const day = today();
  const daily = kind === 'daily';
  const ss = { id, startedAt: id, kind, mode: kind === 'speak' ? 'speak' : 'full', day, items: {}, done: false };
  // 最初に行うステップ。今日の学習では段で決まる（段3以上は、段階1の結果を見てから決める）
  const firstSteps = x => daily ? stepsFor(x.stage, stepsOf(x.sid)) : (kind === 'full' ? stepsOf(x.sid) : []);
  const queue = list.map(x => ({ sid: x.sid, appearance: 1, stage: daily ? x.stage : null, steps: firstSteps(x) }));
  let stop = false, quit;
  const quitted = new Promise(r => { quit = r; });     // 中断したときに、待っている画面を終わらせる
  const askQuit = () => {
    if (confirm('中断してホームに戻りますか？ここまでの記録は残ります。')) { stop = true; voice.stop(); quit(null); home(); }
  };

  let lastSid = null;
  while (queue.length && !stop) {
    const item = queue.shift();
    const S = data.byId[item.sid];
    const firstTime = item.appearance === 1;
    // 他に出す文がなく、同じ文が続くときは、ひと息の画面を挟む（2-3：直後の反復を避ける）
    if (item.sid === lastSid) {
      const go = await Promise.race([quitted, breather(askQuit)]);
      if (stop || !go) break;
    }
    lastSid = item.sid;
    const rest = new Set([item.sid, ...queue.map(q => q.sid)]).size;
    app.innerHTML = `
      <header class="top">${iconBtn('quit', '中断する')}
        <p class="progress">${firstTime ? '' : 'もう一度　'}残り ${rest} 文</p><span class="sid">${S.id}</span></header>
      <main id="step"></main>`;
    app.onclick = e => { if (e.target.closest('[data-act="quit"]')) askQuit(); };
    const el = document.getElementById('step');
    const log = ev => addEvent({ session: id, sid: S.id, appearance: item.appearance, t: new Date().toISOString(), ...ev });

    // 段3以上の最初の出題：一発OK（ゆれなし）なら、段階2を省いて次へ進む（2-1）
    const later = daily && firstTime && item.stage >= 3;
    const res = await Promise.race([quitted, runSpeak(el, {
      sentence: S, voice, settings, mishear: data.mishear,
      extraAnswers: data.patterns[S.id] || [], retryLimit: RETRY_LIMIT, log, quickOk: later,
    })]);
    if (stop || !res) break;

    // 段は、その日の最初の段階1の結果だけで決める（2-1）。ここで保存するので、
    // このあと途中でやめても、この文は済んだ扱いになる（13-6）
    let moved = null;
    if (daily && firstTime) {
      const card = review(cards[S.id], S.id, res.first, day);
      moved = { from: item.stage, to: card.stage, due: card.due };
      cards[S.id] = card;
      await putCard(card);
      log({ type: 'stage', from: moved.from, to: moved.to, due: moved.due, first: res.first });
    }

    // 声に出すステップのあと、残りのステップを順に行う（2-1）
    const steps = later ? laterSteps(res.first, stepsOf(S.id)) : item.steps;
    const wrongSteps = [], wrongCount = {};
    for (const key of steps) {
      const r = await Promise.race([quitted, runStep(key, el, S, log)]);
      if (stop || !r) break;
      wrongCount[key] = r.wrong;
      if (r.wrong > 0) wrongSteps.push(key);
    }
    if (stop) break;

    // 記録に残すのは、その日の最初の出題分（5章：再出題分は習得度に算入しない）
    if (firstTime) {
      const wrongTotal = Object.values(wrongCount).reduce((a, b) => a + b, 0);
      ss.items[S.id] = { first: res.first, appearances: 1, oneShotLater: false, wrong: wrongCount,
                         mastery: mastery(res.first, wrongTotal), ...(moved ? { stage: moved } : {}) };
    }
    const it = ss.items[S.id];
    it.appearances = item.appearance;
    const oneShot = res.first === 'ok' || res.first === 'ok_yure';
    if (!firstTime && oneShot && !wrongSteps.length) it.oneShotLater = true;

    // 一発OKでなかった文・「またあとで」の文・誤答したステップがある文は、他の文を挟んでもう一度（2-3）
    if ((!oneShot || res.again || wrongSteps.length) && item.appearance < REQUEUE_LIMIT) {
      const next = item.appearance + 1;
      // 4回目以降は暗唱を中心にし、まだ言えない文には語順並べ替えだけを添える（2-3）
      const nextSteps = kind === 'speak' ? []
        : next >= LATE_FROM ? (stepsOf(S.id).includes('order') ? ['order'] : [])
        : wrongSteps;
      queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, { sid: S.id, appearance: next, stage: item.stage, steps: nextSteps });
    }
    await putSession(ss);
  }
  if (stop) { await putSession(ss); return; }
  ss.done = true; ss.endedAt = new Date().toISOString();
  await putSession(ss);
  summary(ss);
}

/** 同じ文が続くときのひと息（押すまで進まない） */
function breather(onQuit) {
  return new Promise(resolve => {
    app.innerHTML = `
      <header class="top">${iconBtn('quit', '中断する')}<h1>ひと息</h1><span></span></header>
      <main class="home menu">
        <p class="notice">同じ文をもう一度出します。すこし間をおいてから、思い出して言ってみましょう。</p>
        <button class="btn primary big" data-act="go">つづける</button>
      </main>`;
    app.onclick = e => {
      if (e.target.closest('[data-act="go"]')) resolve(true);
      if (e.target.closest('[data-act="quit"]')) onQuit();
    };
  });
}

// ---------------- 結果 ----------------
function summary(ss) {
  const items = Object.entries(ss.items);
  const count = k => items.filter(([, it]) => it.first === k).length;
  const wrongLine = it => Object.entries(it.wrong || {}).filter(([, n]) => n > 0)
    .map(([k, n]) => `${STEP_LABEL[k]} ${n}`).join('　');
  // 今日の学習では、段がどう動いたかも示す（新規は「段1から」）
  const stageLine = it => !it.stage ? '' : it.stage.from ? `段${it.stage.from} → 段${it.stage.to}` : '新しく覚えた文（段1から）';
  app.innerHTML = `
    <header class="top"><span></span><h1>おつかれさま</h1><span></span></header>
    <main class="summary">
      <div class="stats">
        <div class="ok"><b>${count('ok') + count('ok_yure')}</b><span>一発OK</span></div>
        <div class="mid"><b>${count('retry_ok')}</b><span>やり直して</span></div>
        <div class="ng"><b>${count('ng')}</b><span>言えなかった</span></div>
      </div>
      <ol class="slist">
        ${items.map(([sid, it]) => `<li><span class="sid">${sid}</span><span class="sja">${esc(data.byId[sid].en)}</span>
          <span class="badges"><span class="badge ${FIRST_CLASS[it.first]}">${FIRST_LABEL[it.first]}</span>
            ${it.mastery ? `<span class="badge ${MASTERY_CLASS[it.mastery]}">${MASTERY[it.mastery]}</span>` : ''}</span>
          ${stageLine(it) ? `<span class="rep">${stageLine(it)}</span>` : ''}
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

// ---------------- 記録（文の状態と、これまでの学習） ----------------
async function records() {
  const sessions = (await allSessions()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const cards = await allCards();
  const day = today();
  const when = t => t.slice(0, 16).replace('T', ' ').replace(/-/g, '/');
  // 次の出題日を、今日から数えた言い方にする
  const dueText = c => {
    const n = daysBetween(day, c.due);
    return n <= 0 ? '今日' : n === 1 ? '明日' : `${n}日後（${c.due.slice(5).replace('-', '/')}）`;
  };
  app.innerHTML = `
    <header class="top">${iconBtn('back', '戻る')}<h1>記録</h1><span></span></header>
    <main class="home">
      <h2 class="section-title">文の状態</h2>
      <ol class="slist cards">
        ${data.sentences.map(s => {
          const c = cards[s.id];
          return `<li><span class="sid">${s.id}</span><span class="sja">${esc(s.en)}</span>
            <span class="badges">${c
              ? `<span class="badge stage">段${c.stage}</span><span class="rep">次は ${dueText(c)}${c.lapses ? `　段1に戻った回数 ${c.lapses}` : ''}</span>`
              : '<span class="badge">まだ</span>'}</span></li>`;
        }).join('')}
      </ol>
      <h2 class="section-title">これまでの学習</h2>
      ${sessions.length ? '' : '<p class="notice">まだ記録がありません。</p>'}
      <ol class="slist">
        ${sessions.map(ss => `<li><span class="sid">${when(ss.startedAt)}</span>
          <span class="sja">${Object.keys(ss.items || {}).length}文　${KIND_LABEL[ss.kind || ss.mode] || '自由に練習'}${ss.done ? '' : '（中断）'}</span>
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
  const head = ['t', 'sid', 'appearance', 'type', 'attempt', 'check', 'match', 'heard', 'ops', 'pieces', 'error',
                'readyMs', 'waitMs', 'restarts', 'retrySilence', 'retryMore', 'shortStops', 'first', 'again',
                'wid', 'word', 'label', 'wrong', 'from', 'to', 'due'];
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
