// 音声認識（まとめ 8-4）
// ・🎤を押した時点から聞く。話し始めまで無音で切れたら、最大 waitLimit まで自動でやり直す
// ・聞き取った語数が正解文より少なければ、最大 pauseWindow まで続きを待ってつなぐ（文が短ければ待つ方式）
// ・ブラウザの連続認識モードは使わない（Android で不安定なため）
import { wordCount } from './judge.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = () => !!SR;

export class Listener {
  constructor({ target, waitLimit = 8000, pauseWindow = 5000, hardCap = 30000, onState = () => {} }) {
    this.targetWords = wordCount(target);
    Object.assign(this, { waitLimit, pauseWindow, hardCap, onState });
  }

  start() {
    return new Promise(resolve => {
      const s = this.s = {
        t0: performance.now(), speechAt: 0, lastHeardAt: 0, restarts: 0,
        finals: [], interim: '', lastError: '', userStopped: false, done: false, rec: null,
      };
      s.ticker = setInterval(() => {
        const sec = Math.floor((performance.now() - s.t0) / 1000);
        this.onState(s.speechAt ? 'hearing' : 'waiting', sec);
      }, 250);
      s.cap = setTimeout(() => this.stop(), this.hardCap);

      const finish = () => {
        if (s.done) return;
        s.done = true;
        clearInterval(s.ticker); clearTimeout(s.cap); clearTimeout(s.watch);
        if (s.interim) s.finals.push([s.interim.trim()]);
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
          waitMs: s.speechAt ? Math.round(s.speechAt - s.t0) : null,
          restarts: s.restarts,
          totalMs: Math.round(performance.now() - s.t0),
        });
      };
      this._finish = finish;

      const heardWords = () => wordCount(s.finals.map(f => f[0]).join(' '));

      const launch = () => {
        const r = new SR();
        r.lang = 'en-US';
        r.continuous = false;
        r.interimResults = false;
        r.maxAlternatives = 3;
        r.onspeechstart = () => { if (!s.speechAt) s.speechAt = performance.now(); };
        r.onresult = e => {
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
          s.lastHeardAt = performance.now();
        };
        r.onerror = e => { s.lastError = e.error; };
        r.onend = () => {
          if (s.done) return;
          const now = performance.now();
          const heard = s.finals.length > 0;
          const fatal = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture',
                         'language-not-supported'].includes(s.lastError);
          if (fatal) return finish();
          // 話し始める前に切れた：待ち時間の上限まで作り直す
          if (!heard && !s.userStopped && now - s.t0 < this.waitLimit) {
            s.restarts++; s.lastError = '';
            return setTimeout(launch, 120);
          }
          // 語数が足りない：続きを待って作り直す
          if (heard && !s.userStopped && heardWords() < this.targetWords && now - s.lastHeardAt < this.pauseWindow) {
            s.restarts++; s.lastError = '';
            return setTimeout(launch, 120);
          }
          finish();
        };
        s.rec = r;
        try { r.start(); }
        catch (e) { s.lastError = 'start-failed'; finish(); }
      };
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
    'no-speech': '声が聞き取れませんでした。もう一度どうぞ。',
    'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。',
    'service-not-allowed': 'この端末では音声認識が使えません。',
    'network': '通信できないため、音声認識が使えません。',
    'audio-capture': 'マイクが見つかりません。',
    'language-not-supported': '英語の音声認識が使えません。',
  }[code] || '音声認識でエラーが起きました（' + code + '）。';
}

// 自己判定に切り替えるべきエラー（まとめ 8-4：通信できないときは自己判定）
export const isFatal = code => ['not-allowed', 'service-not-allowed', 'network', 'audio-capture',
                                'language-not-supported', 'start-failed'].includes(code);
