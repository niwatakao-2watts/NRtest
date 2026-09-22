// 暗唱の判定：正規化 → 完全一致 → 聞き取りゆれ（まとめ 8-4・15-12）

const CONTRACTIONS = [
  [/\bi'm\b/g, 'i am'], [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'], [/\bdon't\b/g, 'do not'], [/\bdoesn't\b/g, 'does not'],
  [/\bdidn't\b/g, 'did not'], [/\bisn't\b/g, 'is not'], [/\baren't\b/g, 'are not'],
  [/\bwasn't\b/g, 'was not'], [/\bweren't\b/g, 'were not'], [/\bcouldn't\b/g, 'could not'],
  [/\bshouldn't\b/g, 'should not'], [/\bwouldn't\b/g, 'would not'], [/\bmustn't\b/g, 'must not'],
  [/\bhaven't\b/g, 'have not'], [/\bhasn't\b/g, 'has not'], [/\bhadn't\b/g, 'had not'],
  [/\byou'll\b/g, 'you will'], [/\bi'll\b/g, 'i will'], [/\bhe'll\b/g, 'he will'],
  [/\bshe'll\b/g, 'she will'], [/\bwe'll\b/g, 'we will'], [/\bthey'll\b/g, 'they will'],
  [/\bit'll\b/g, 'it will'], [/\bit's\b/g, 'it is'], [/\bthat's\b/g, 'that is'],
  [/\bwhat's\b/g, 'what is'], [/\bthere's\b/g, 'there is'], [/\blet's\b/g, 'let us'],
  [/\bhe's\b/g, 'he is'], [/\bshe's\b/g, 'she is'],
  [/\byou're\b/g, 'you are'], [/\bwe're\b/g, 'we are'], [/\bthey're\b/g, 'they are'],
  [/\bi've\b/g, 'i have'], [/\byou've\b/g, 'you have'], [/\bwe've\b/g, 'we have'], [/\bthey've\b/g, 'they have'],
  [/\bi'd\b/g, 'i would'], [/\byou'd\b/g, 'you would'],
];
// アポストロフィが抜けて書き起こされた形（ill・wed など別の語と紛れるものは入れない）
const NO_APOS = [
  [/\bcant\b/g, 'can not'], [/\bwont\b/g, 'will not'], [/\bdont\b/g, 'do not'],
  [/\bdoesnt\b/g, 'does not'], [/\bdidnt\b/g, 'did not'], [/\bisnt\b/g, 'is not'],
  [/\barent\b/g, 'are not'], [/\bwasnt\b/g, 'was not'], [/\bwerent\b/g, 'were not'],
  [/\bcouldnt\b/g, 'could not'], [/\bshouldnt\b/g, 'should not'], [/\bmustnt\b/g, 'must not'],
  [/\bhavent\b/g, 'have not'], [/\bhasnt\b/g, 'has not'],
  [/\byoull\b/g, 'you will'], [/\btheyll\b/g, 'they will'], [/\bweve\b/g, 'we have'],
  [/\bive\b/g, 'i have'], [/\byouve\b/g, 'you have'], [/\bim\b/g, 'i am'], [/\bthats\b/g, 'that is'],
];
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const numWords = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');

// 同じ音の別の語：発音では区別できないので同じ語として扱う（発音課題にしない）
const HOMOPHONES = {
  two: 'to', too: 'to', four: 'for', their: 'there', hear: 'here', write: 'right',
  know: 'no', knew: 'new', won: 'one', buy: 'by', bye: 'by', sea: 'see', our: 'hour',
  weak: 'week', meat: 'meet', wood: 'would', hole: 'whole', son: 'sun', wait: 'weight',
};

export function normalize(s) {
  let t = String(s || '').toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");
  t = t.replace(/\b(\d{1,2}):00\b/g, '$1').replace(/\b(\d{1,2}):(\d{2})\b/g, '$1 $2');
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  for (const [re, to] of NO_APOS) t = t.replace(re, to);
  t = t.replace(/\b(\d{1,2})\b/g, (m, d) => numWords(+d));
  return t.split(/\s+/).filter(Boolean).map(w => HOMOPHONES[w] || w).join(' ');
}

// 短縮形と同じ音になる語（you're / your、they're / their / there、it's / its）を寄せた比較用の形
function loose(n) {
  return (' ' + n + ' ').replace(/ you are /g, ' your ').replace(/ they are /g, ' there ')
    .replace(/ it is /g, ' its ').trim();
}

export function wordDiff(targetN, heardN) {
  const a = targetN ? targetN.split(' ') : [];
  const b = heardN ? heardN.split(' ') : [];
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) ops.push({ t: 'sub', from: a[i - 1], to: b[j - 1] });
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      ops.push({ t: 'del', from: a[i - 1] }); i--;
    } else {
      ops.push({ t: 'ins', to: b[j - 1] }); j--;
    }
  }
  return ops.reverse();
}

export function diffLabel(o) {
  if (o.t === 'sub') return `${o.from} → ${o.to}`;
  if (o.t === 'del') return `${o.from} が抜け`;
  return `${o.to} が余分`;
}

export function makeMishearSet(rows) {
  const set = new Set();
  for (const r of rows || []) {
    const a = normalize(r.correct), b = normalize(r.heard);
    if (a && b && !a.includes(' ') && !b.includes(' ')) set.add(`${a}|${b}`);
  }
  return set;
}

/**
 * 聞き取った候補を正解文と比べる。
 * 戻り値 match: 'exact'（完全一致）/ 'yure'（登録済みの聞き取りゆれ1語だけの違い）/ 'none'
 * best: 正解文に最も近い候補（違いの表示に使う）
 */
export function judge(target, candidates, mishearSet, extraAnswers = []) {
  const answers = [target, ...extraAnswers].map(normalize);
  const cands = (candidates || []).map(c => ({ raw: c, n: normalize(c) })).filter(c => c.n);
  if (!cands.length) return { match: 'none', best: null, ops: [], heard: '' };
  const answersLoose = answers.map(loose);
  for (const c of cands) {
    if (answers.includes(c.n) || answersLoose.includes(loose(c.n))) {
      return { match: 'exact', best: c.raw, ops: [], heard: c.raw };
    }
  }
  let best = null;
  for (const c of cands) {
    for (const a of answers) {
      const ops = wordDiff(a, c.n);
      if (!best || ops.length < best.ops.length) best = { c, ops };
    }
  }
  const o = best.ops;
  if (o.length === 1 && o[0].t === 'sub' && mishearSet && mishearSet.has(`${o[0].from}|${o[0].to}`)) {
    return { match: 'yure', best: best.c.raw, ops: o, heard: best.c.raw, yure: { from: o[0].from, to: o[0].to } };
  }
  return { match: 'none', best: best.c.raw, ops: o, heard: best.c.raw };
}

export function wordCount(s) {
  const t = normalize(s);
  return t ? t.split(' ').length : 0;
}
