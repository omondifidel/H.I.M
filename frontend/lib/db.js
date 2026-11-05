// Tiny IndexedDB wrapper: "pdfs" (downloaded files), "paras" (paragraph splits), "notes" (offline notes).
const STORES = ["pdfs", "paras", "notes"];
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("readaloud", 2);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}
export const idbGet = (store, key) => run(store, "readonly", (s) => s.get(key));
export const idbPut = (store, key, val) => run(store, "readwrite", (s) => s.put(val, key));
export const idbDel = (store, key) => run(store, "readwrite", (s) => s.delete(key));
export const idbKeys = (store) => run(store, "readonly", (s) => s.getAllKeys());
export const idbAll = (store) => run(store, "readonly", (s) => s.getAll());
export const idbClear = (store) => run(store, "readwrite", (s) => s.clear());
export async function idbDelPrefix(store, prefix) {
  const keys = await idbKeys(store);
  for (const k of keys) if (String(k).startsWith(prefix)) await idbDel(store, k);
}
