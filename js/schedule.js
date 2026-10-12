// 段方式のスケジュール（まとめ 2-1・2-2）と、総合習得度（5章）
// 画面を持たない、計算だけの部品。日付は 'YYYY-MM-DD' の文字で扱う（比べるだけなら文字のままでよい）。

/** 段ごとの「前回からの間隔（日）」。添字が段（段1＝1日、段2＝2日 … 段8＝90日。2-1） */
export const INTERVALS = [0, 1, 2, 4, 7, 16, 30, 60, 90];
export const MAX_STAGE = 8;
export const DAY_START_HOUR = 4;       // 1日の区切りは午前4時（2-2）
export const DAILY_MINUTES = 45;       // 1日の学習時間の目安（10-2）
export const NEW_LIMIT = 5;            // 1日の新規文数の上限（10-2）
/** 1文あたりの所要時間の見積もり（秒）。2-4 の仮定。記録がたまったら実測値に置き換える */
const SECONDS = { fresh: 150, 1: 90, 2: 75, later: 40 };

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };

/** 学習日を返す。午前4時より前は、前の日として扱う。offsetDays は確認用（何日後として動かすか） */
export function studyDay(now = new Date(), offsetDays = 0) {
  const d = new Date(now.getTime() - DAY_START_HOUR * 3600000);
  d.setDate(d.getDate() + offsetDays);
  return fmt(d);
}
export function addDays(day, n) {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return fmt(d);
}
export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 86400000);

/**
 * 次の段を決める（2-1）。判定に使うのは、その日の最初の段階1の結果だけ。
 * stage：いまの段（0＝まだ学習していない） first：'ok' | 'ok_yure' | 'retry_ok' | 'ng'
 */
export function nextStage(stage, first) {
  if (!stage) return 1;                                         // 新規は、結果によらず段1から始める
  if (first === 'ok') return Math.min(stage + 1, MAX_STAGE);    // 一発OK（ゆれなし）：1段上がる
  if (first === 'ok_yure') return stage;                        // 一発OK（ゆれあり）：据え置き（発音を練習するため）
  if (first === 'retry_ok') return Math.max(stage - 1, 1);      // やり直して一致：1段下がる
  return 1;                                                     // 言えない・思い出せない：段1に戻る
}

/** 1文を学習したあとの記録（段と次の出題日）を作る。card：これまでの記録（新規なら undefined） */
export function review(card, sid, first, today) {
  const before = card?.stage || 0;
  const stage = nextStage(before, first);
  return {
    sid, stage,
    due: addDays(today, INTERVALS[stage]),
    last: today,
    introduced: card?.introduced || today,       // 初めて学習した日（1日の新規の数を数えるのに使う）
    firstEver: card?.firstEver || first,         // 新規のときの結果（授業の内容がどれだけ残っていたか。2-1）
    lapses: (card?.lapses || 0) + (before >= 1 && first === 'ng' ? 1 : 0),   // 段1に戻った回数（苦手の指標）
    reviews: (card?.reviews || 0) + 1,
  };
}

/**
 * その区分で、声に出すステップのあとに行うステップ（2-1）。
 * all：その文にデータがあるステップ。段3以上は、段階1の結果で決まるため null を返す（→ laterFlow）
 */
export function stepsFor(stage, all) {
  const pick = keys => keys.filter(k => all.includes(k));
  if (!stage) return pick(['meaning', 'structureA', 'structureB', 'cloze', 'order']);   // 新規：全ステップ
  if (stage === 1) return pick(['meaning', 'structureA', 'order']);
  if (stage === 2) return pick(['meaning', 'structureA']);
  return null;
}

/** 段3以上：段階1の1回目の結果で、その後に行うステップを決める（2-1） */
export function laterSteps(first, all) {
  if (first === 'ok' || first === 'ok_yure') return [];        // 一発OKなら、他のステップは省く
  return all.includes('meaning') ? ['meaning'] : [];           // それ以外：意味理解（そのあと、もう一度出題される）
}

/**
 * 今日の出題を組み立てる（2-2）。
 *   1. 期日が来た文をすべて出す。段の低い順、同じ段なら期日を過ぎた日数の長い順
 *   2. 時間の目安に余りがあれば、新規を最大 NEW_LIMIT 文まで加える（文IDの順）
 * ids：全部の文ID（文IDの順） cards：文ID → 記録
 */
export function buildToday(ids, cards, today) {
  const studied = ids.map(sid => cards[sid]).filter(Boolean);
  const due = studied.filter(c => c.due <= today)
    .sort((a, b) => a.stage - b.stage || a.due.localeCompare(b.due) || a.sid.localeCompare(b.sid));
  let seconds = due.reduce((sum, c) => sum + (SECONDS[c.stage] || SECONDS.later), 0);

  const introducedToday = studied.filter(c => c.introduced === today).length;
  const fresh = [];
  for (const sid of ids) {
    if (cards[sid]) continue;
    if (introducedToday + fresh.length >= NEW_LIMIT) break;
    if (seconds + SECONDS.fresh > DAILY_MINUTES * 60) break;
    fresh.push(sid);
    seconds += SECONDS.fresh;
  }
  return {
    due: due.map(c => c.sid), fresh,
    minutes: Math.round(seconds / 60),
    doneToday: studied.filter(c => c.last === today).length,    // 今日すでに終えた文の数
    untouched: ids.filter(sid => !cards[sid]).length,           // まだ学習していない文の数
  };
}

/** 総合習得度（5章）。段階1の1回目の結果と、他のステップの誤答の合計から決める。低いほうを取る */
export const MASTERY = {
  perfect: 'パーフェクト', good: 'ほぼ習得', close: 'あと少し', again: '再チャレンジ',
};
export function mastery(first, wrongTotal) {
  const bySpeak = { ok: 3, ok_yure: 2, retry_ok: 1 }[first] ?? 0;
  const bySteps = wrongTotal === 0 ? 3 : wrongTotal <= 2 ? 2 : wrongTotal <= 4 ? 1 : 0;
  return ['again', 'close', 'good', 'perfect'][Math.min(bySpeak, bySteps)];
}
