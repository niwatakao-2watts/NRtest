// 音声認識（まとめ 8-4）
//
// 流れ：🎤を押す →「準備中」→ マイクが開いたら「どうぞ」→ 言葉が取れたら「聞いています」→ 判定へ
//
// ・話してよいのは、マイクが実際に開いてから（onaudiostart）。待ち時間もそこから数える
// ・やり直しは理由ごとに上限を持つ（下の RETRY を参照）。上限に達したら自動では続けず、本人の操作を待つ
// ・ブラウザの連続認識モードは使わない（Android で不安定なため）
import { wordCount } from './judge.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = () => !!SR;

// やり直しの決まり（まとめ 8-4）
const RETRY = {
  // 声が取れないまま切れた場合。Android は無音が続くと3秒ほどで打ち切るため、少しだけ待ち直す
  silence: { max: 2, window: 8000 },
  // 語数が足りない場合の続き待ち。前回より語が増えたときだけ続ける（増えないなら実りがない）
  more: { max: 1, window: 5000 },
};
const GAP_MS = 400;        // やり直しの間隔。短いと端末の開始音と終了音が重なって濁った音になる
const SHORT_MS = 1000;     // これより短く終わった回は「空振り」として記録に残す（上限の判定には使わない）
const FATAL = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported'];

export class Listener {
  /** onState: 表示の切り替え（preparing / waiting / hearing）、onReady: 話してよい合図 */
  constructor({ target, hardCap = 30000, onState = () => {}, onReady = () => {} }) {
    this.targetWords = wordCount(target);
    Object.assign(this, { hardCap, onState, onReady });
  }

  start() {
    return new Promise(resolve => {
      const s = this.s = {
        t0: performance.now(),
        readyAt: 0,        // マイクが開いた時刻（ここから話してよい。待ち時間の起点）
        speechAt: 0,       // 声が始まったと端末が判断した時刻（記録用）
        heardAt: 0,        // 言葉が実際に取れた時刻（「聞いています」の表示用）
        lastHeardAt: 0,    // 最後に言葉が取れた時刻（続き待ちの判断用）
        launchedAt: performance.now(),
        retries: { silence: 0, more: 0 },   // 理由ごとのやり直し回数
        shortStops: 0,     // 1秒未満で終わった回数（記録用）
        finals: [], interim: '', lastError: '', userStopped: false, done: false, rec: null,
      };

      s.ticker = setInterval(() => {
        const sec = Math.floor((performance.now() - (s.readyAt || s.t0)) / 1000);
        this.onState(!s.readyAt ? 'preparing' : s.heardAt ? 'hearing' : 'waiting', sec);
      }, 250);
      s.cap = setTimeout(() => this.stop(), this.hardCap);

      const finish = () => {
        if (s.done) return;
        s.done = true;
        clearInterval(s.ticker); clearTimeout(s.cap); clearTimeout(s.watch);
        if (s.interim) s.finals.push([s.interim.trim()]);
        try { s.rec && s.rec.abort(); } catch (e) { /* 無視 */ }    // マイクを確実に手放す
        let cands = [];
        if (s.finals.length === 1) cands = s.finals[0];
        else if (s.finals.length > 1) {
          const joined = s.finals.map(f => f[0]).join(' ');
          const last = s.finals[s.finals.length - 1][0];
          cands = joined === last ? [joined] : [joined, last];
        }
        resolve({
          cands,
          pieces: s.finals.map(f => f[0]),
          error: cands.length ? '' : (s.lastError || 'no-speech'),
          readyMs: s.readyAt ? Math.round(s.readyAt - s.t0) : null,
          waitMs: s.speechAt ? Math.round(s.speechAt - (s.readyAt || s.t0)) : null,
          restarts: s.retries.silence + s.retries.more,
          retrySilence: s.retries.silence,
          retryMore: s.retries.more,
          shortStops: s.shortStops,
          totalMs: Math.round(performance.now() - s.t0),
        });
      };
      this._finish = finish;

      const heardWords = () => wordCount(s.finals.map(f => f[0]).join(' '));

      /**
       * 終わったときに、やり直すかどうかを決める（まとめ 8-4）。
       * 戻り値：やり直す理由（'silence' | 'more'）、やり直さないなら null
       */
      const nextReason = now => {
        if (s.userStopped) return null;
        const reason = s.finals.length ? 'more' : 'silence';
        const rule = RETRY[reason];
        if (s.retries[reason] >= rule.max) return null;            // 理由ごとの上限
        if (reason === 'silence') {
          return now - (s.readyAt || s.t0) < rule.window ? 'silence' : null;
        }
        // 続き待ちは、語数が足りず、かつ前回より語が増えたときだけ（増えないなら実りがない）
        const words = heardWords();
        const grew = words > s.wordsAtRetry;
        if (words >= this.targetWords || !grew) return null;
        return now - s.lastHeardAt < rule.window ? 'more' : null;
      };

      // やり直しのたびに番号を進める。古い認識から遅れて届く知らせは無視する
      // （二重に動くと、端末の開始音・終了音が重なって濁った音になり、聞き取りも不安定になる）
      let gen = 0;

      const launch = () => {
        const my = ++gen;
        const mine = () => my === gen && !s.done;
        const r = new SR();
        r.lang = 'en-US';
        r.continuous = false;
        r.interimResults = false;
        r.maxAlternatives = 3;

        // マイクの取り込みが始まった＝ここから話してよい
        r.onaudiostart = () => {
          if (!mine() || s.readyAt) return;
          s.readyAt = performance.now();
          this.onReady();
        };
        r.onspeechstart = () => { if (mine() && !s.speechAt) s.speechAt = performance.now(); };
        r.onresult = e => {
          if (!mine()) return;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) {
              const alts = [];
              for (let j = 0; j < res.length; j++) alts.push(res[j].transcript.trim());
              s.finals.push(alts);
              s.interim = '';
            } else {
              s.interim = res[0].transcript;
            }
          }
          if (!s.speechAt) s.speechAt = performance.now();
          if (!s.heardAt) s.heardAt = performance.now();     // 言葉が取れた＝「聞いています」
          s.lastHeardAt = performance.now();
        };
        r.onerror = e => { if (mine()) s.lastError = e.error; };
        r.onend = () => {
          if (!mine()) return;
          const now = performance.now();
          if (now - s.launchedAt < SHORT_MS) s.shortStops++;         // 記録用（上限の判定には使わない）
          if (FATAL.includes(s.lastError)) return finish();
          const reason = nextReason(now);
          if (!reason) return finish();
          s.retries[reason]++;
          s.wordsAtRetry = heardWords();      // このやり直しで語が増えたかを、次の終わりで見る
          s.lastError = '';
          return setTimeout(launch, GAP_MS);
        };

        s.rec = r;
        s.launchedAt = performance.now();
        try { r.start(); }
        catch (e) { s.lastError = 'start-failed'; finish(); }
      };

      s.wordsAtRetry = 0;
      launch();
    });
  }

  stop() {
    const s = this.s;
    if (!s || s.done) return;
    s.userStopped = true;
    try { s.rec && s.rec.stop(); } catch (e) { /* 無視 */ }
    // stop() のあと終わりの知らせが来ない端末への備え
    s.watch = setTimeout(() => this._finish && this._finish(), 4000);
  }
}

export function errorMessage(code) {
  return {
    'no-speech': '声が聞き取れませんでした。',
    'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。',
    'service-not-allowed': 'この端末では音声認識が使えません。',
    'network': '通信できないため、音声認識が使えません。',
    'audio-capture': 'マイクが見つかりません。',
    'language-not-supported': '英語の音声認識が使えません。',
  }[code] || '音声認識でエラーが起きました（' + code + '）。';
}

// 自己判定に切り替えるべきエラー（まとめ 8-4：通信できないときは自己判定）
export const isFatal = code => FATAL.includes(code) || code === 'start-failed';
