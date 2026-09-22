// 第1段階：声に出すステップ（段階1・段階2）で10文を回す
import { loadData } from './data.js';
import { Voice } from './audio.js';
import { runSpeak } from './speak.js';
import { sttSupported } from './stt.js';
import { addEvent, putSession, allSessions, eventsOf } from './db.js';

const RETRY_LIMIT = 5;      // 段階1のやり直し上限（まとめ 10-2）
const REQUEUE_LIMIT = 15;   // セッション内反復の上限（2-3）
const REQUEUE_GAP = 3;      // 再出題までに挟む文の数（2-3：直後に連続させない）

const DEFAULTS = { voice: 'male', speed: 'normal', autoJa: true, sound: true, haptics: true, theme: 'light', size: 'l' };
const loadSettings = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('eigo-settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; } };
const saveSettings = s => { try { localStorage.setItem('eigo-settings', JSON.stringify(s)); } catch (e) { /* 無視 */ } };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIRST_LABEL = { ok: '一発OK', ok_yure: '一発OK（ゆれ）', retry_ok: 'やり直して言えた', ng: '言えなかった' };
const FIRST_CLASS = { ok: 'ok', ok_yure: 'near', retry_ok: 'mid', ng: 'ng' };

const app = document.getElementById('app');
let settings = loadSettings();
let data = null;
const voice = new Voice(() => settings);

function applyLook() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.size = settings.size;
}

// ---------------- ホーム ----------------
async function home() {
  applyLook();
  const sessions = (await allSessions()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latest = {};
  for (const ss of sessions) for (const [sid, it] of Object.entries(ss.items || {})) if (!latest[sid]) latest[sid] = it.first;
  const files = await voice.hasFiles(data.sentences[0].id);

  app.innerHTML = `
    <header class="top"><span></span><h1>暗唱トレーニング</h1><button class="icon-btn" data-act="settings">設定</button></header>
    <main class="home">
      <button class="btn primary big" data-act="start">${data.sentences.length}文を練習する</button>
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
    if (b.dataset.act === 'start') session(data.sentences.map(s => s.id));
    if (b.dataset.act === 'settings') settingsView();
  };
}

// ---------------- 設定（本人が変えられるもの。まとめ 10-1） ----------------
function settingsView() {
  const opt = (key, pairs) => `<div class="segs wide" role="group">${pairs.map(([v, l]) =>
    `<button class="seg ${settings[key] === v ? 'on' : ''}" data-key="${key}" data-val="${v}" aria-pressed="${settings[key] === v}">${l}</button>`).join('')}</div>`;
  const onoff = [[true, 'ON'], [false, 'OFF']];
  app.innerHTML = `
    <header class="top"><button class="icon-btn" data-act="back">戻る</button><h1>設定</h1><span></span></header>
    <main class="settings">
      <label>声</label>${opt('voice', [['male', '男性'], ['female', '女性']])}
      <label>英語の速さ</label>${opt('speed', [['normal', 'ふつう'], ['slow', 'ゆっくり'], ['fast', 'はやい']])}
      <label>日本語の自動読み上げ</label>${opt('autoJa', onoff)}
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
async function session(ids) {
  const id = new Date().toISOString();
  const ss = { id, startedAt: id, items: {}, done: false };
  const queue = ids.map(sid => ({ sid, appearance: 1 }));
  let stop = false;

  while (queue.length && !stop) {
    const item = queue.shift();
    const S = data.byId[item.sid];
    const rest = new Set([item.sid, ...queue.map(q => q.sid)]).size;
    app.innerHTML = `
      <header class="top"><button class="icon-btn" data-act="quit">中断</button>
        <p class="progress">${item.appearance > 1 ? 'もう一度　' : ''}残り ${rest} 文</p><span class="sid">${S.id}</span></header>
      <main id="step"></main>`;
    app.onclick = e => {
      const b = e.target.closest('[data-act="quit"]');
      if (b && confirm('中断してホームに戻りますか？ここまでの記録は残ります。')) { stop = true; voice.stop(); home(); }
    };
    const res = await runSpeak(document.getElementById('step'), {
      sentence: S, voice, settings, mishear: data.mishear,
      extraAnswers: data.patterns[S.id] || [], retryLimit: RETRY_LIMIT,
      log: ev => addEvent({ session: id, sid: S.id, appearance: item.appearance, t: new Date().toISOString(), ...ev }),
    });
    if (stop) break;

    const it = ss.items[S.id] || (ss.items[S.id] = { first: res.first, appearances: 0, oneShotLater: false });
    it.appearances = item.appearance;
    const oneShot = res.first === 'ok' || res.first === 'ok_yure';
    if (item.appearance > 1 && oneShot) it.oneShotLater = true;
    // 一発OKでなかった文・「またあとで」の文は、他の文を挟んでもう一度（まとめ 2-3）
    if ((!oneShot || res.again) && item.appearance < REQUEUE_LIMIT) {
      queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, { sid: S.id, appearance: item.appearance + 1 });
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
          ${it.appearances > 1 ? `<span class="rep">${it.appearances}回目${it.oneShotLater ? 'で一発OK' : 'まで'}</span>` : ''}</li>`).join('')}
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

function downloadCsv(id, evs) {
  const head = ['t', 'sid', 'appearance', 'type', 'attempt', 'check', 'match', 'heard', 'ops', 'pieces', 'error', 'waitMs', 'restarts', 'first', 'again'];
  const cell = v => `"${String(Array.isArray(v) ? v.join(' | ') : (v ?? '')).replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [head.join(','), ...evs.map(e => head.map(h => cell(e[h])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `session-${id.slice(0, 19).replace(/[-:T]/g, '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
