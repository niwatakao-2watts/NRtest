// 音声認識（まとめ 8-4）
// ・🎤を押した時点から聞く。話し始めまで無音で切れたら、最大 waitLimit まで自動でやり直す
// ・聞き取った語数が正解文より少なければ、最大 pauseWindow まで続きを待ってつなぐ（文が短ければ待つ方式）
// ・ブラウザの連続認識モードは使わない（Android で不安定なため）
import { wordCount } from './judge.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = () => !!SR;

const RESTART_GAP = 400;      // やり直しの間隔。短いと端末の開始音と終了音が重なって濁った音になる
const RESTART_MAX = 3;        // やり直しの回数の上限（音が何度も鳴るのを防ぐ）
const SHORT_MS = 1000;        // これより短く終わった空振りは、やり直しの回数に数えない

export class Listener {
  constructor({ target, waitLimit = 8000, pauseWindow = 5000, hardCap = 30000,
                onState = () => {}, onReady = () => {} }) {
    this.targetWords = wordCount(target);
    Object.assign(this, { waitLimit, pauseWindow, hardCap, onState, onReady });
  }

  start() {
    return new Promise(resolve => {
      const s = this.s = {
        t0: performance.now(), readyAt: 0, speechAt: 0, heardAt: 0, lastHeardAt: 0, restarts: 0,
        finals: [], interim: '', lastError: '', userStopped: false, done: false, rec: null,
        launchedAt: performance.now(), shortStops: 0,
      };
      // 「準備中」→「どうぞ」→「聞いています」。マイクが実際に開くまで 0.3〜1秒かかるため、
      // 準備ができるまで話し始めないように伝える（まとめ 8-4）
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
          restarts: s.restarts,
          shortStops: s.shortStops,
          totalMs: Math.round(performance.now() - s.t0),
        });
      };
      this._finish = finish;

      const heardWords = () => wordCount(s.finals.map(f => f[0]).join(' '));

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
        // マイクの取り込みが始まった＝ここから話してよい。待ち時間はこの時点から数える
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
          if (!s.heardAt) s.heardAt = performance.now();     // 言葉が取れた＝「聞いています」（B）
          s.lastHeardAt = performance.now();
        };
        r.onerror = e => { if (mine()) s.lastError = e.error; };
        r.onend = () => {
          if (!mine()) return;
          const now = performance.now();
          const heard = s.finals.length > 0;
          const fatal = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture',
                         'language-not-supported'].includes(s.lastError);
          if (fatal) return finish();
          const canRestart = !s.userStopped && s.restarts < RESTART_MAX;
          // 話し始める前に切れた：待ち時間の上限まで作り直す
          if (!heard && canRestart && now - (s.readyAt || s.t0) < this.waitLimit) {
            // 1秒未満で空振りに終わった回（息や物音で始まってすぐ切れた場合）は回数に数えない（C）
            if (now - s.launchedAt >= SHORT_MS) s.restarts++;
            s.shortStops += now - s.launchedAt < SHORT_MS ? 1 : 0;
            s.lastError = '';
            return setTimeout(launch, RESTART_GAP);
          }
          // 語数が足りない：続きを待って作り直す
          if (heard && canRestart && heardWords() < this.targetWords && now - s.lastHeardAt < this.pauseWindow) {
            s.restarts++; s.lastError = '';
            return setTimeout(launch, RESTART_GAP);
          }
          finish();
        };
        s.rec = r;
        s.launchedAt = performance.now();
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
