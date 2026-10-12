// 学習記録の保存（IndexedDB。まとめ 8-1）
//   events   … 出来事（段階1の各回、各ステップの結果など）
//   sessions … 1回の学習のまとめ
//   cards    … 文ごとの段と次の出題日（M3で追加。まとめ 2-1）
const NAME = 'eigo-app', VERSION = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('events')) {
        const s = db.createObjectStore('events', { keyPath: 'key', autoIncrement: true });
        s.createIndex('session', 'session');
      }
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      // 版2：文ごとの記録。これまでの events・sessions はそのまま残る
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'sid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  });
}

export const addEvent = ev => tx('events', 'readwrite', s => s.add(ev)).catch(e => console.warn(e));
export const putSession = ss => tx('sessions', 'readwrite', s => s.put(ss)).catch(e => console.warn(e));
export const allSessions = () => tx('sessions', 'readonly', s => s.getAll()).catch(() => []);
/** 文ごとの記録を、文ID → 記録 の形で返す */
export const allCards = () => tx('cards', 'readonly', s => s.getAll())
  .then(rows => Object.fromEntries((rows || []).map(c => [c.sid, c]))).catch(() => ({}));
export const putCard = card => tx('cards', 'readwrite', s => s.put(card)).catch(e => console.warn(e));
export async function eventsOf(sessionId) {
  const db = await open();
  return new Promise(resolve => {
    const r = db.transaction('events').objectStore('events').index('session').getAll(sessionId);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
