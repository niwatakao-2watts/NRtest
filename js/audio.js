// 音声の再生（まとめ 8-2・15-2）
// 生成済みの MP3 があればそれを使い、なければブラウザの読み上げで代用する。

const RATE = { ja: 1.25, normal: 0.85, slow: 0.65, fast: 1.25 };   // 生成時と同じ速度（代用時に使う）

export class Voice {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.missing = new Set();
    this.usingFallback = false;
    this._resolve = null;
  }

  url(sid, kind, speed) {
    const v = this.getSettings().voice;
    return kind === 'ja' ? `audio/${v}/${sid}_ja.mp3` : `audio/${v}/${sid}_en_${speed}.mp3`;
  }

  /** kind: 'ja' | 'en'。再生が終わったら解決する Promise を返す */
  play(sentence, kind, speed) {
    this.stop();
    speed = speed || this.getSettings().speed;
    const url = this.url(sentence.id, kind, speed);
    const text = kind === 'ja' ? stripParen(sentence.jaTts || sentence.ja) : sentence.en;
    const rate = kind === 'ja' ? RATE.ja : RATE[speed];
    return new Promise(resolve => {
      this._resolve = resolve;
      let fell = false;
      const fallback = () => {
        if (fell || this._resolve !== resolve) return;    // 読み込み失敗と再生失敗の両方で呼ばれても1回だけ
        fell = true;
        this.missing.add(url); this.usingFallback = true; this._speak(text, kind, rate, resolve);
      };
      if (this.missing.has(url)) return fallback();
      const el = this.el;
      el.onended = () => this._done();
      el.onerror = fallback;
      el.src = url;
      el.play().catch(fallback);
    });
  }

  _speak(text, kind, rate, resolve) {
    if (!('speechSynthesis' in window)) return this._done();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = kind === 'ja' ? 'ja-JP' : 'en-US';
    u.rate = rate;
    const want = this.getSettings().voice === 'female' ? /female|woman|samantha|zira|kyoko|o-ren/i : /male|man|daniel|david|otoya|ichiro/i;
    const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.replace('_', '-').startsWith(u.lang));
    u.voice = vs.find(v => want.test(v.name)) || vs[0] || null;
    u.onend = u.onerror = () => this._done();
    speechSynthesis.speak(u);
  }

  _done() {
    const r = this._resolve; this._resolve = null;
    if (r) r();
  }

  stop() {
    try { this.el.pause(); } catch (e) { /* 無視 */ }
    this.el.onended = this.el.onerror = null;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this._done();
  }

  /** 1文目の音声ファイルがあるかを確かめる（ホーム画面の表示用） */
  async hasFiles(sid) {
    try {
      const r = await fetch(this.url(sid, 'en', 'normal'), { method: 'HEAD', cache: 'no-store' });
      return r.ok;
    } catch (e) { return false; }
  }
}

export function stripParen(t) {
  return String(t || '').replace(/（[^（）]*）|\([^()]*\)/g, '').trim();
}

// 正解の効果音（まとめ 13-11）と触覚（13-10）。控えめにする
let ctx = null;
export function chime(settings) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(30);
  if (!settings.sound) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    [[660, 0], [880, 0.09]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t + d); o.stop(t + d + 0.3);
    });
  } catch (e) { /* 無視 */ }
}
