// 問題データの読み込み（tools/build_data.py が作る data/*.json）
// 端末への保存と手動更新（まとめ 8-5）は、PWA 化の段階で加える。
import { makeMishearSet } from './judge.js';

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path} を読み込めませんでした（${r.status}）`);
  return r.json();
}

export async function loadData() {
  const index = await getJSON('data/index.json');
  const common = await getJSON('data/' + index.common.file);
  const packs = await Promise.all(index.packs.map(p => getJSON('data/' + p.file)));
  const merged = {};
  for (const p of packs) for (const [k, v] of Object.entries(p)) (merged[k] = merged[k] || []).push(...v);
  const sentences = (merged.sentences || []).sort((a, b) => a.id.localeCompare(b.id));
  const patterns = {};
  for (const r of merged.patterns || []) (patterns[r.sid] = patterns[r.sid] || []).push(r.text);
  // 文ごとに、各ステップのデータを引ける形にまとめる（M2。まとめ 15-3〜15-6）
  const group = rows => {
    const m = {};
    for (const r of rows || []) (m[r.sid] = m[r.sid] || []).push(r);
    return m;
  };
  const byNo = m => { for (const rows of Object.values(m)) rows.sort((a, b) => (a.no || 0) - (b.no || 0)); return m; };
  const wordsById = Object.fromEntries((common.words || []).map(w => [w.id, w]));
  const words = {};
  for (const [sid, rows] of Object.entries(group(merged.sentenceWords))) {
    words[sid] = rows.sort((a, b) => (a.order || 0) - (b.order || 0)).map(r => wordsById[r.wid]).filter(Boolean);
  }

  return {
    index, common, sentences, patterns,
    byId: Object.fromEntries(sentences.map(s => [s.id, s])),
    mishear: makeMishearSet(common.mishear),
    words,
    structure: byNo(group(merged.structure)),
    order: byNo(group(merged.order)),
    cloze: Object.fromEntries((merged.cloze || []).map(r => [r.sid, r])),
    structureChoice: Object.fromEntries((merged.structureChoice || []).map(r => [r.sid, r])),
    raw: merged,
  };
}
