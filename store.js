export function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("stillglass", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("kv");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("kv", "readonly").objectStore("kv").get("dir");
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function writeHandle(dir) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(dir, "dir");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function stampName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `stillglass-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
}

export function safeFolder(name) {
  const clean = String(name || "Stillglass")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^\.+/, "")
    .trim();
  return clean || "Stillglass";
}
