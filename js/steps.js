// M2：意味理解（4-2）・構造把握（4-3）・空欄補充（4-4）・語順並べ替え（4-5）
// どのステップも、正解したら自動で次へ進み、誤答は控えめに知らせる（13-5・13-9）。
// 戻り値は { wrong } で、wrong は誤答の回数（意味理解は 4-2 の正規化ルールにより 0 か 1）。
//
// 画面の作り（13-3）：問いは上、押すものは下。片手で持ったとき親指が届く位置に選択肢を置く。
// 正解したときに画面が動かないよう、あとから出る表示の場所はあらかじめ空けておく。
import { chime } from './audio.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const NEXT_MS = 260;              // 誤答のあとなど、軽い間（13-8：0.2秒程度）
const SHOW_MS = 1200;             // 正解を見せてから次へ進むまで（正解の内容を印象づけるため）

/** 正解の印（太い丸）。文字の「○」は線が細く目立たないため、図形で描く */
export const MARK = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg>';

/** 誤答の知らせ方（13-5：音は鳴らさない。13-10：振動は短く2回） */
function buzz(settings) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate([20, 60, 20]);
}

/**
 * 画面の枠。top：問い（上）、bottom：押すもの（下に寄せる）、actions：いちばん下の操作
 * center を true にすると、top を画面の中ほどに置く（文のかたち用）
 */
function frame(root, { name, pos, top = '', bottom = '', actions = '', center = false }) {
  root.innerHTML = `
    <section class="step" aria-label="${esc(name)}">
      <p class="stage-label"><span class="dot on"></span>${esc(name)}${pos ? `　${esc(pos)}` : ''}</p>
      <div class="qtop ${center ? 'center' : ''}">${top}</div>
      ${bottom ? `<div class="qbottom">${bottom}</div>` : ''}
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </section>`;
}

/**
 * 4択（意味理解・構造把握B・空欄補充で共通）。
 * 誤答はグレーのまま残し（13-9）、正解したら正解だけをはっきり見せて、他は薄くする。
 * en：英語の選択肢（英文と同じ書体にする）
 */
function choices(opts, dead, correct, { en = false } = {}) {
  const solved = correct >= 0;
  const note = dead.size && !solved ? 'ちがいます。残りから選びましょう' : '';
  return `<ul class="opts">${opts.map((o, i) => `
    <li><button class="opt ${en ? 'en' : ''} ${dead.has(i) ? 'dead' : ''} ${correct === i ? 'hit' : ''} ${solved && correct !== i ? 'fade' : ''}"
        data-opt="${i}" ${dead.has(i) || solved ? 'disabled' : ''}>${correct === i ? MARK : ''}<span>${esc(o)}</span></button></li>`).join('')}</ul>
    <p class="qnote">${note}</p>`;
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
      const solved = hit >= 0;
      frame(root, {
        name: '単語の意味', pos: `${i + 1}/${words.length}`,
        top: `
          <div class="wordcard ${solved ? 'solved' : ''}">
            <p class="wordhead"><button class="word-play" data-act="play-word">${esc(w.word)}</button></p>
            <p class="wordsub">${esc(w.pos || '')}${w.ipa ? `　<span class="ipa">${esc(w.ipa)}</span>` : ''}</p>
            <p class="answer-slot">${solved ? `<span class="answer">${MARK}${esc(w.meaning)}</span>` : ''}</p>
          </div>`,
        bottom: choices(opts, dead, hit),
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

    let qi = 0, wrong = 0, note = '', busy = false;   // busy：正解のあとの短い間。この間のタップは受け付けない
    const solved = new Map();          // 語順番号 → ラベル（色を残すため）
    const missed = new Set();          // この問いで一度誤答した語（2回目は数えない）

    const draw = (flash = null) => {
      const q = groups[qi];
      const sentence = rows.map(r => {
        const lab = solved.get(r.no);
        const cls = ['w', lab ? `on e-${ELEM_KEY[lab]}` : '', flash === r.no ? 'miss' : ''].join(' ');
        return `<button class="${cls}" data-no="${r.no}">${esc(r.word)}</button>`;
      }).join('');
      frame(root, {
        name: '文のかたち', pos: `${qi + 1}/${groups.length}`, center: true,
        top: `
          <p class="ask"><span class="e-${ELEM_KEY[q.label]} tag">${esc(q.label)}</span><span>をタップ</span></p>
          <p class="wordline">${sentence}</p>
          <p class="qnote">${esc(note)}</p>`,
      });
    };

    const tap = async no => {
      // 正解のあとの間や、すべて終わったあとのタップは数えない（続けて押したときに誤答扱いにしないため）
      if (busy || qi >= groups.length) return;
      const q = groups[qi];
      const row = rows.find(r => r.no === no);
      if (q.nos.includes(no)) {
        for (const n of q.nos) solved.set(n, q.label);
        note = ''; missed.clear(); draw(); chime(settings);
        ctx.log({ type: 'structureA', label: q.label, wrong });
        busy = true;
        await wait(NEXT_MS);
        busy = false;
        if (++qi < groups.length) return draw();
        return resolve({ wrong });
      }
      if (!missed.has(no)) { missed.add(no); wrong++; }    // 同じ語の2回目は数えない（4-3）
      buzz(settings);
      note = row && row.label ? `そこは「${row.label}」のはたらきです` : 'この文の骨組みになる語を探しましょう';
      draw(no);
      await wait(400);
      if (qi < groups.length) draw();                      // 誤答の表示は元に戻す（13-9）
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
      top: `
        <p class="en big">${esc(S.en)}</p>
        <p class="fb-label">合っている日本語訳はどれですか</p>`,
      bottom: choices(opts, dead, hit),
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
    // 空欄の幅は一定にする（正解の語の長さに合わせると、長さがヒントになってしまうため）
    const line = fill => orderWords.map(w => w.no === cloze.blankNo
      ? `<span class="blank ${fill ? 'filled' : ''}">${fill ? esc(cloze.answer) : '&nbsp;'}</span>` : esc(w.word)).join(' ');

    const draw = () => frame(root, {
      name: '空欄をうめる',
      top: `
        <p class="en big">${line(done)}${esc(tailMark(S.en))}</p>
        <p class="ja small">${esc(S.ja)}</p>`,
      bottom: choices(opts, dead, hit, { en: true }),
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

    // 文の先頭の語も小文字で見せる（大文字が先頭のヒントになるため。4-5）
    const show = word => (word === 'I' || word.startsWith('I\'')) ? word
      : word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()
        ? word[0].toLowerCase() + word.slice(1) : word;

    const draw = (flash = -1) => {
      const built = main.slice(0, at).map(w => w.word).join(' ');
      frame(root, {
        name: '語をならべる',
        top: `
          <p class="ja small">${esc(S.ja)}</p>
          <p class="built ${done ? 'solved' : ''}">${done ? MARK : ''}<span>${esc(built)}${done ? esc(tailMark(S.en)) : ''}</span>${done ? '' : '<span class="caret"></span>'}</p>`,
        // 使ったタイルは場所を動かさず、跡だけ残す（並びが変わると押し間違えるため）
        bottom: `
          <div class="tiles">${tiles.map(t => `
            <button class="tile ${used.has(t.key) ? 'used' : ''} ${flash === t.key ? 'miss' : ''}"
              data-key="${t.key}" ${used.has(t.key) ? 'disabled' : ''}>${esc(show(t.word))}</button>`).join('')}</div>
          <p class="qnote">${esc(note)}</p>`,
        // 完成したあとも場所は残す（消すと、タイルの位置が動いてしまうため）
        actions: `<button class="btn quiet ${done ? 'ghost' : ''}" data-act="reset" ${done ? 'disabled' : ''}>最初からやり直す</button>`,
      });
    };

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
      await wait(400); note = '';
      if (!done) draw();                                   // 表示は元に戻す（13-9）
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
