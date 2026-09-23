// M2：意味理解（4-2）・構造把握（4-3）・空欄補充（4-4）・語順並べ替え（4-5）
// どのステップも、正解したら自動で次へ進み、誤答は控えめに知らせる（13-5・13-9）。
// 戻り値は { wrong } で、wrong は誤答の回数（意味理解は 4-2 の正規化ルールにより 0 か 1）。
import { chime } from './audio.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const NEXT_MS = 260;              // 誤答のあとなど、軽い間（13-8：0.2秒程度）
const SHOW_MS = 1200;             // 正解を見せてから次へ進むまで（正解の内容を印象づけるため）

/** 誤答の知らせ方（13-5：音は鳴らさない。13-10：振動は短く2回） */
function buzz(settings) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate([20, 60, 20]);
}

/** 画面の枠。上部にステップ名、中央に内容、下部に操作（13-3） */
function frame(root, { name, pos, body, actions = '' }) {
  root.innerHTML = `
    <section class="step" aria-label="${esc(name)}">
      <p class="stage-label"><span class="dot on"></span>${esc(name)}${pos ? `　${esc(pos)}` : ''}</p>
      <div class="qbody">${body}</div>
      <div class="actions">${actions}</div>
    </section>`;
}

/**
 * 4択（意味理解・構造把握B・空欄補充で共通）。
 * 誤答はグレーのまま残し（13-9）、正解したら正解だけをはっきり見せて、他は薄くする。
 */
function choices(opts, dead, correct) {
  const solved = correct >= 0;
  return `<ul class="opts">${opts.map((o, i) => `
    <li><button class="opt ${dead.has(i) ? 'dead' : ''} ${correct === i ? 'hit' : ''} ${solved && correct !== i ? 'fade' : ''}"
        data-opt="${i}" ${dead.has(i) || solved ? 'disabled' : ''}>${correct === i ? '<span class="mark">○</span>' : ''}${esc(o)}</button></li>`).join('')}</ul>`;
}

/**
 * 意味理解（4-2）。文に紐づく単語を順に4択で問う。
 * ctx: { sentence, words, voice, settings, log }
 */
export function runMeaning(root, ctx) {
  const { words, voice, settings } = ctx;
  return new Promise(resolve => {
    if (!words.length) return resolve({ wrong: 0 });
    let i = 0, wrongAny = false, opts = [], dead = new Set(), hit = -1;

    const start = () => {
      const w = words[i];
      opts = shuffle([w.meaning, w.dummy1, w.dummy2, w.dummy3]);
      dead = new Set(); hit = -1;
      draw();
      voice.play({ id: w.id, en: w.word }, 'word');
    };

    const draw = () => {
      const w = words[i];
      frame(root, {
        name: '単語の意味', pos: `${i + 1}/${words.length}`,
        body: `
          <div class="wordcard ${hit >= 0 ? 'solved' : ''}">
            <p class="wordhead">${hit >= 0 ? '<span class="mark big">○</span>' : ''}<button class="word-play" data-act="play-word">${esc(w.word)}</button></p>
            <p class="wordsub">${esc(w.pos || '')}${w.ipa ? `　<span class="ipa">${esc(w.ipa)}</span>` : ''}</p>
            ${hit >= 0 ? `<p class="answer">${esc(w.meaning)}</p>` : ''}
          </div>
          ${choices(opts, dead, hit)}
          <p class="fb-sub">${dead.size && hit < 0 ? 'ちがいます。残りから選びましょう' : ''}</p>`,
      });
    };

    const tap = async n => {
      const w = words[i];
      if (opts[n] === w.meaning) {
        hit = n; draw(); chime(settings);
        ctx.log({ type: 'meaning', wid: w.id, word: w.word, wrong: dead.size });
        await wait(SHOW_MS);
        if (++i < words.length) return start();
        return resolve({ wrong: wrongAny ? 1 : 0 });     // 4-2：文ごとに一律1とする
      }
      wrongAny = true; dead.add(n); buzz(settings); draw();
    };

    root.onclick = e => {
      const b = e.target.closest('[data-opt],[data-act]');
      if (!b || b.disabled || hit >= 0) return;
      if (b.dataset.act === 'play-word') return void voice.play({ id: words[i].id, en: words[i].word }, 'word');
      tap(Number(b.dataset.opt));
    };
    start();
  });
}

const ELEMENTS = ['主語', '動詞', '助動詞', '目的語', '間接目的語', '補語'];
const ELEM_KEY = { '主語': 's', '動詞': 'v', '助動詞': 'aux', '目的語': 'o', '間接目的語': 'io', '補語': 'c' };

/**
 * 構造把握・形式A（語タップ式。4-3）。
 * 2語以上のまとまりは、どの語をタップしても正解とし、まとまり全体を色付けする（15-4）。
 * ctx: { sentence, rows, settings, log }
 */
export function runStructureA(root, ctx) {
  const { rows, settings } = ctx;
  return new Promise(resolve => {
    // ラベルごとに、まとまり（語順番号の並び）をまとめる
    const groups = ELEMENTS.map(label => {
      const g = rows.filter(r => r.label === label);
      return g.length ? { label, nos: g.map(r => r.no), order: g[0].order ?? Math.min(...g.map(r => r.no)) } : null;
    }).filter(Boolean).sort((a, b) => a.order - b.order);
    if (!groups.length) return resolve({ wrong: 0 });

    let qi = 0, wrong = 0, note = '';
    const solved = new Map();          // 語順番号 → ラベル（色を残すため）
    const missed = new Set();          // この問いで一度誤答した語（2回目は数えない）

    const draw = (flash = null) => {
      const q = groups[qi];
      const sentence = rows.map(r => {
        const lab = solved.get(r.no);
        const cls = ['w', lab ? `on e-${ELEM_KEY[lab]}` : '', flash === r.no ? 'miss' : ''].join(' ');
        return `<button class="${cls}" data-no="${r.no}">${esc(r.word)}</button>`;
      }).join(' ');
      frame(root, {
        name: '文のかたち', pos: `${qi + 1}/${groups.length}`,
        body: `
          <p class="ask"><span class="e-${ELEM_KEY[q.label]} tag">${esc(q.label)}</span>の中心の語をタップしてください</p>
          <p class="wordline">${sentence}</p>
          <p class="fb-sub">${esc(note)}</p>`,
      });
    };

    const tap = async no => {
      const q = groups[qi];
      const row = rows.find(r => r.no === no);
      if (q.nos.includes(no)) {
        for (const n of q.nos) solved.set(n, q.label);
        note = ''; missed.clear(); draw(); chime(settings);
        ctx.log({ type: 'structureA', label: q.label, wrong });
        await wait(NEXT_MS);
        if (++qi < groups.length) return draw();
        return resolve({ wrong });
      }
      if (!missed.has(no)) { missed.add(no); wrong++; }    // 同じ語の2回目は数えない（4-3）
      buzz(settings);
      note = row && row.label ? `そこは「${row.label}」のはたらきです` : 'この文の骨組みになる語を探しましょう';
      draw(no);
      await wait(400);
      draw();                                              // 誤答の表示は元に戻す（13-9）
    };

    root.onclick = e => {
      const b = e.target.closest('[data-no]');
      if (b) tap(Number(b.dataset.no));
    };
    draw();
  });
}

/**
 * 構造把握・形式B（和訳選択。4-3）。
 * ctx: { sentence, choice, settings, log }
 */
export function runStructureB(root, ctx) {
  const { sentence: S, choice, settings } = ctx;
  return new Promise(resolve => {
    const opts = shuffle([choice.correct, choice.wrong1, choice.wrong2, choice.wrong3]);
    let wrong = 0, hit = -1;
    const dead = new Set();
    const draw = () => frame(root, {
      name: '意味の取り方',
      body: `
        <p class="en big">${esc(S.en)}</p>
        ${hit >= 0
          ? `<p class="answer lead"><span class="mark big">○</span>${esc(choice.correct)}</p>`
          : '<p class="fb-label">合っている日本語訳はどれですか</p>'}
        ${choices(opts, dead, hit)}
        <p class="fb-sub">${dead.size && hit < 0 ? 'ちがいます。残りから選びましょう' : ''}</p>`,
    });

    root.onclick = async e => {
      const b = e.target.closest('[data-opt]');
      if (!b || b.disabled || hit >= 0) return;
      const n = Number(b.dataset.opt);
      if (opts[n] === choice.correct) {
        hit = n; draw(); chime(settings);
        ctx.log({ type: 'structureB', wrong });
        await wait(SHOW_MS);
        return resolve({ wrong });
      }
      wrong++; dead.add(n); buzz(settings); draw();
    };
    draw();
  });
}

/**
 * 空欄補充（4-4）。英文と日本語訳を出し、空欄に入る語を4択で選ぶ。
 * ctx: { sentence, cloze, orderWords, voice, settings, log }
 */
export function runCloze(root, ctx) {
  const { sentence: S, cloze, orderWords, voice, settings } = ctx;
  return new Promise(resolve => {
    const opts = shuffle([cloze.answer, cloze.dummy1, cloze.dummy2, cloze.dummy3]);
    let wrong = 0, hit = -1, done = false;
    const dead = new Set();
    const line = fill => orderWords.map(w => w.no === cloze.blankNo
      ? `<span class="blank ${fill ? 'filled' : ''}">${esc(fill ? cloze.answer : '　　　')}</span>` : esc(w.word)).join(' ');

    const draw = () => frame(root, {
      name: '空欄をうめる',
      body: `
        <p class="en big">${line(done)}${esc(tailMark(S.en))}</p>
        <p class="ja small">${esc(S.ja)}</p>
        ${done ? `<p class="answer lead"><span class="mark big">○</span>${esc(cloze.answer)}</p>` : ''}
        ${choices(opts, dead, hit)}
        <p class="fb-sub">${dead.size && hit < 0 ? 'ちがいます。残りから選びましょう' : ''}</p>`,
    });

    root.onclick = async e => {
      const b = e.target.closest('[data-opt]');
      if (!b || b.disabled || hit >= 0) return;
      const n = Number(b.dataset.opt);
      if (opts[n] === cloze.answer) {
        hit = n; done = true; draw(); chime(settings);
        ctx.log({ type: 'cloze', wrong });
        if (settings.echo) await voice.play(S, 'en');      // 完成した文を音でも確かめる
        await wait(SHOW_MS);
        return resolve({ wrong });
      }
      wrong++; dead.add(n); buzz(settings); draw();
    };
    draw();
  });
}

/**
 * 語順並べ替え（4-5）。語のタイルを順にタップして文を組み立てる。不要語が1語混ざる。
 * ctx: { sentence, rows, voice, settings, log }
 */
export function runOrder(root, ctx) {
  const { sentence: S, rows, voice, settings } = ctx;
  return new Promise(resolve => {
    const main = rows.filter(r => r.extra !== 1).sort((a, b) => a.no - b.no);
    const tiles = shuffle(rows.map((r, i) => ({ key: i, word: r.word, extra: r.extra === 1 })));
    let at = 0, wrong = 0, done = false, note = '';
    const used = new Set();
    const missed = new Set();          // この位置で一度誤答したタイル（2回目は数えない）

    const draw = (flash = -1) => {
      const built = main.slice(0, at).map(w => w.word).join(' ');
      frame(root, {
        name: '語をならべる',
        body: `
          <p class="ja small">${esc(S.ja)}</p>
          <p class="built ${done ? 'solved' : ''}">${done ? '<span class="mark">○</span>' : ''}${esc(built)}${done ? esc(tailMark(S.en)) : '<span class="caret"></span>'}</p>
          <div class="tiles">${tiles.map(t => `
            <button class="tile ${used.has(t.key) ? 'used' : ''} ${flash === t.key ? 'miss' : ''}"
              data-key="${t.key}" ${used.has(t.key) ? 'disabled' : ''}>${esc(show(t.word, t))}</button>`).join('')}</div>
          <p class="fb-sub">${esc(note)}</p>`,
        actions: done ? '' : '<button class="btn quiet" data-act="reset">最初からやり直す</button>',
      });
    };

    // 文の先頭の語も小文字で見せる（大文字が先頭のヒントになるため。4-5）
    const show = word => (word === 'I' || word.startsWith('I\'')) ? word
      : word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
        ? word[0].toLowerCase() + word.slice(1) : word;

    const tap = async key => {
      const t = tiles.find(x => x.key === key);
      const want = main[at].word.toLowerCase();
      if (!t.extra && t.word.toLowerCase() === want) {     // 同じ語ならどちらのタイルでもよい（4-5）
        used.add(key); at++; note = ''; missed.clear();
        if (at < main.length) { draw(); return; }
        done = true; draw(); chime(settings);
        ctx.log({ type: 'order', wrong });
        if (settings.echo) await voice.play(S, 'en');
        await wait(SHOW_MS);
        return resolve({ wrong });
      }
      if (!missed.has(key)) { missed.add(key); wrong++; }
      buzz(settings); note = 'そこはまだ先です'; draw(key);
      await wait(400); note = ''; draw();                  // 表示は元に戻す（13-9）
    };

    root.onclick = e => {
      const b = e.target.closest('[data-key],[data-act]');
      if (!b || b.disabled || done) return;
      if (b.dataset.act === 'reset') { used.clear(); missed.clear(); at = 0; note = ''; return draw(); }
      tap(Number(b.dataset.key));
    };
    draw();
  });
}

/** 文末の記号（「.」「?」など）。タイルには含めず、完成したときに補う */
export function tailMark(en) {
  const m = String(en || '').match(/[.?!]+$/);
  return m ? m[0] : '';
}
