// 学習記録の保存（IndexedDB。まとめ 8-1）
const NAME = 'eigo-app', VERSION = 1;
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
export async function eventsOf(sessionId) {
  const db = await open();
  return new Promise(resolve => {
    const r = db.transaction('events').objectStore('events').index('session').getAll(sessionId);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
