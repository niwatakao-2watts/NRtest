// 声に出すステップ（まとめ 4-1）
// 段階1：思い出して言う … 日本語訳だけを見て英文を言う。記録に残るのは1回目の結果
// 段階2：確かめてまねる … お手本を聞いてまねる。🎤で何度でも確かめられる
import { judge, diffLabel } from './judge.js';
import { Listener, sttSupported, errorMessage, isFatal } from './stt.js';
import { chime } from './audio.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="stroke" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path class="stroke" d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/></svg>',
};
const SPEEDS = [['normal', 'ふつう'], ['slow', 'ゆっくり'], ['fast', 'はやい']];

/**
 * ctx: { sentence, voice, settings, mishear, extraAnswers, retryLimit, log(ev) }
 * 戻り値: { first: 'ok'|'ok_yure'|'retry_ok'|'ng', again, attempts, checks, self }
 */
export function runSpeak(root, ctx) {
  const { sentence: S, voice, settings } = ctx;
  const st = {
    stage: 1, attempts: 0, first: null, solved: false, last: null, note: '',
    listening: null, listenLabel: '', self: !sttSupported(),
    checks: 0, check: null, showEn: false, speed: settings.speed,
  };

  return new Promise(resolve => {
    const finish = again => {
      stopAll();
      root.onclick = null;
      ctx.log({ type: 'done', first: st.first, again, attempts: st.attempts, checks: st.checks, self: st.self });
      resolve({ first: st.first, again, attempts: st.attempts, checks: st.checks, self: st.self });
    };

    const stopAll = () => {
      voice.stop();
      if (st.listening) st.listening.stop();
    };

    // ---------- 段階1 ----------
    const stage1 = () => {
      const listening = !!st.listening;
      let fb = '', actions = '';
      if (st.note) fb += `<p class="fb-note">${esc(st.note)}</p>`;

      if (st.solved) {
        const one = st.first === 'ok' || st.first === 'ok_yure';
        fb += `<p class="fb-big ok">${one ? '一発OK' : '言えました'}</p>`;
        if (st.last && st.last.match === 'yure') fb += `<p class="fb-sub">「${esc(st.last.yure.to)}」と聞こえました（${esc(st.last.yure.from)} の発音を意識しましょう）</p>`;
        actions = `<button class="btn primary" data-act="to2">お手本で確かめる</button>`;
      } else if (st.self) {
        fb += `<p class="fb-sub">音声認識が使えないため、自分で判定してください。</p>`;
        actions = `<div class="pair"><button class="btn" data-act="self-ng">言えなかった</button>
                   <button class="btn primary" data-act="self-ok">言えた</button></div>
                   ${sttSupported() ? '<button class="btn quiet" data-act="retry-mic">マイクでもう一度試す</button>' : ''}`;
      } else {
        if (st.last && st.last.match === 'none') {
          fb += `<p class="fb-label">聞き取った文</p><p class="heard">${esc(st.last.heard)}</p>`;
          fb += `<p class="fb-sub">もう一度言うか、答えを聞いてください（${st.attempts}/${ctx.retryLimit}回）</p>`;
        }
        const label = listening ? st.listenLabel : (st.attempts ? 'もう一度言う' : '話す');
        actions = `<button class="btn mic ${listening ? (st.ready ? 'live' : 'preparing') : ''}" data-act="${listening ? 'stop' : 'say'}">${ICON.mic}<span>${esc(label)}</span></button>
                   <button class="btn quiet" data-act="giveup" ${listening ? 'disabled' : ''}>${st.attempts ? '答えを聞く' : '思い出せない'}</button>`;
      }

      root.innerHTML = `
        <section class="step" aria-label="段階1 思い出して言う">
          <p class="stage-label"><span class="dot on"></span><span class="dot"></span>思い出して言う</p>
          <p class="ja">${esc(S.ja)}</p>
          <div class="tools"><button class="tool" data-act="play-ja" ${listening ? 'disabled' : ''}>${ICON.speaker}日本語</button></div>
          <div class="feedback" aria-live="polite">${fb}</div>
          <div class="actions">${actions}</div>
        </section>`;
    };

    // マイクが実際に開くまで 0.3〜1秒かかる。開くまでは「準備中」と出し、
    // 開いた時点で「どうぞ」に変える（まとめ 8-4）。ここで初めて話してよい
    const listener = redraw => new Listener({
      target: S.en,
      onState: (kind, sec) => {
        st.listenLabel = kind === 'preparing' ? '準備中…'
          : kind === 'waiting' ? `どうぞ　${sec}秒` : '聞いています（タップで終わる）';
        const b = root.querySelector('[data-act="stop"] span');
        if (b) b.textContent = st.listenLabel;
      },
      onReady: () => {
        st.ready = true;
        if (settings.haptics && navigator.vibrate) navigator.vibrate(30);   // 話してよい合図（13-10）
        redraw();
      },
    });

    const say = async () => {
      voice.stop();
      st.note = '';
      const L = listener(() => stage1());
      st.listening = L; st.ready = false; st.listenLabel = '準備中…'; stage1();
      const r = await L.start();
      st.listening = null;
      if (r.error) {
        ctx.log({ type: 's1', attempt: st.attempts + 1, error: r.error, readyMs: r.readyMs, waitMs: r.waitMs, restarts: r.restarts });
        if (isFatal(r.error)) { st.self = true; st.note = errorMessage(r.error); }
        // 声がなかった場合は回数に数えない。話し始めが早すぎると頭の語が届かないため、その案内を添える
        else st.note = errorMessage(r.error) + '（🎤を押したあと、「どうぞ」が出てから話してください）';
        return stage1();
      }
      st.attempts++;
      const j = judge(S.en, r.cands, ctx.mishear, ctx.extraAnswers);
      st.last = j;
      ctx.log({ type: 's1', attempt: st.attempts, match: j.match, heard: j.heard, pieces: r.pieces,
                cands: r.cands, ops: j.ops.map(diffLabel), readyMs: r.readyMs, waitMs: r.waitMs,
                restarts: r.restarts, totalMs: r.totalMs });
      if (st.attempts === 1) st.first = j.match === 'exact' ? 'ok' : j.match === 'yure' ? 'ok_yure' : null;
      if (j.match !== 'none') {
        st.solved = true;
        if (!st.first) st.first = 'retry_ok';
        chime(settings);
        voice.play(S, 'en', st.speed);          // 答え合わせとして英語を1回流す
        return stage1();
      }
      if (st.attempts >= ctx.retryLimit) {
        st.first = st.first || 'ng';
        st.note = `${ctx.retryLimit}回言っても一致しなかったので、お手本を聞きましょう。`;
        return stage2();
      }
      stage1();
    };

    // ---------- 段階2 ----------
    const stage2 = (fromStage1 = true) => {
      if (fromStage1 && st.stage === 1) { st.stage = 2; if (!st.solved) st.first = st.first || 'ng'; }
      const listening = !!st.listening;
      let fb = '';
      if (st.note) fb += `<p class="fb-note">${esc(st.note)}</p>`;
      const c = st.check;
      if (c && c.error) fb += `<p class="fb-sub">${esc(errorMessage(c.error))}</p>`;
      else if (c) {
        if (c.match === 'exact') fb += `<p class="fb-big ok">お手本どおりに聞き取れました</p>`;
        else if (c.match === 'yure') fb += `<p class="fb-big near">「${esc(c.yure.to)}」と聞こえました</p><p class="fb-sub">${esc(c.yure.from)} の発音を意識して、もう一度まねてみましょう</p>`;
        else fb += `<p class="fb-big">ちがうところ</p><ul class="diff">${c.ops.map(o => `<li>${esc(diffLabel(o))}</li>`).join('')}</ul>`;
        fb += `<p class="fb-label">聞き取った文</p><p class="heard">${esc(c.heard)}</p>`;
      }

      // 音声のボタンは下にまとめ、繰り返し聞きやすくする（13-4）
      const speedBtns = SPEEDS.map(([k, l]) => `
        <button class="btn play ${st.speed === k ? 'on' : ''}" data-act="speed" data-speed="${k}"
          ${listening ? 'disabled' : ''} aria-pressed="${st.speed === k}">${ICON.speaker}<span>${l}</span></button>`).join('');
      // ↑ 押すたびにその速さで再生する（4-1）
      root.innerHTML = `
        <section class="step" aria-label="段階2 確かめてまねる">
          <p class="stage-label"><span class="dot done"></span><span class="dot on"></span>確かめてまねる</p>
          <div class="show-box">
            <p class="${st.showEn ? 'en' : 'ja'}">${esc(st.showEn ? S.en : S.ja)}</p>
            <button class="link" data-act="toggle-en" ${listening ? 'disabled' : ''}>${st.showEn ? '日本語を表示' : '英語を表示'}</button>
          </div>
          <div class="feedback" aria-live="polite">${fb}</div>
          <div class="actions">
            <div class="plays" role="group" aria-label="お手本を聞く">${speedBtns}</div>
            ${sttSupported() ? `<button class="btn mic ${listening ? (st.ready ? 'live' : 'preparing') : ''}" data-act="${listening ? 'stop' : 'check'}">${ICON.mic}<span>${esc(listening ? st.listenLabel : '言って確かめる')}</span></button>` : ''}
            <div class="pair">
              <button class="btn" data-act="later" ${listening ? 'disabled' : ''}>またあとで</button>
              <button class="btn strong-outline" data-act="done" ${listening ? 'disabled' : ''}>できた</button>
            </div>
          </div>
        </section>`;
    };

    const check = async () => {
      voice.stop();
      st.note = '';
      const L = listener(() => stage2(false));
      st.listening = L; st.ready = false; st.listenLabel = '準備中…'; stage2(false);
      const r = await L.start();
      st.listening = null;
      if (r.error) {
        st.check = { error: r.error };
        if (isFatal(r.error)) st.self = true;
      } else {
        st.checks++;
        st.check = judge(S.en, r.cands, ctx.mishear, ctx.extraAnswers);
        if (st.check.match === 'exact') chime(settings);
      }
      ctx.log({ type: 's2', check: st.checks, match: st.check.match, heard: st.check.heard, error: st.check.error,
                ops: (st.check.ops || []).map(diffLabel), readyMs: r.readyMs, waitMs: r.waitMs, restarts: r.restarts });
      stage2(false);
    };

    // ---------- 操作 ----------
    root.onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'play-ja') voice.play(S, 'ja');
      else if (act === 'play-en') voice.play(S, 'en', st.speed);
      else if (act === 'say') say();
      else if (act === 'retry-mic') { st.self = false; st.note = ''; say(); }
      else if (act === 'check') check();
      else if (act === 'stop') st.listening && st.listening.stop();
      else if (act === 'giveup') { voice.stop(); ctx.log({ type: 's1-giveup', attempts: st.attempts }); st.note = ''; stage2(); }
      else if (act === 'to2') { st.note = ''; stage2(); }
      else if (act === 'self-ok') {
        st.attempts++; st.first = st.first || 'ok'; st.solved = true;
        ctx.log({ type: 's1', attempt: st.attempts, match: 'self-ok' });
        chime(settings); voice.play(S, 'en', st.speed); stage1();
      } else if (act === 'self-ng') {
        st.attempts++; st.first = st.first || 'ng';
        ctx.log({ type: 's1', attempt: st.attempts, match: 'self-ng' });
        stage2();
      }
      else if (act === 'toggle-en') { st.showEn = !st.showEn; stage2(false); }
      else if (act === 'speed') { st.speed = b.dataset.speed; stage2(false); voice.play(S, 'en', st.speed); }
      else if (act === 'later') finish(true);
      else if (act === 'done') finish(false);
    };

    // 始め：日本語の自動読み上げ（まとめ 10-1）
    stage1();
    if (settings.autoJa) voice.play(S, 'ja');
  });
}
