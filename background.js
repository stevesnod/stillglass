import { ENGINE_IDS, ENGINES, isPublicUrl } from "./engines.js";

const SEARCH_ITEMS = [
  ["sg-google", "Search Google Lens", ["google"]],
  ["sg-tineye", "Search TinEye", ["tineye"]],
  ["sg-yandex", "Search Yandex", ["yandex"]],
  ["sg-bing", "Search Bing", ["bing"]],
  ["sg-all", "Search all four", ENGINE_IDS],
];

function installMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "sg",
      title: "Stillglass",
      contexts: ["image", "video", "page"],
    });
    chrome.contextMenus.create({
      id: "sg-loupe",
      parentId: "sg",
      title: "Open loupe",
      contexts: ["image"],
    });
    for (const [id, title] of SEARCH_ITEMS) {
      chrome.contextMenus.create({
        id,
        parentId: "sg",
        title,
        contexts: ["image"],
      });
    }
    chrome.contextMenus.create({
      id: "sg-frame",
      parentId: "sg",
      title: "Grab this frame",
      contexts: ["video"],
    });
    chrome.contextMenus.create({
      id: "sg-page",
      parentId: "sg",
      title: "Capture the visible page",
      contexts: ["page", "image", "video"],
    });
  });
}

chrome.runtime.onInstalled.addListener(installMenus);
chrome.runtime.onStartup.addListener(installMenus);

function openTab(url, tab) {
  chrome.tabs.create({ url, index: tab && Number.isInteger(tab.index) ? tab.index + 1 : undefined });
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function ensureContent(tabId) {
  if (await ping(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    return false;
  }
  return ping(tabId);
}

async function tell(tab, message) {
  if (!tab?.id) return false;
  const ready = await ensureContent(tab.id);
  if (!ready) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    return false;
  }
}

function searchPublic(engines, imageUrl, tab) {
  for (const id of engines) {
    const engine = ENGINES[id];
    if (engine) openTab(engine.search(imageUrl), tab);
  }
}

async function searchBlob(engines, dataUrl, tab) {
  await chrome.storage.session.set({ stillglassImage: dataUrl });
  for (const id of engines) {
    if (!ENGINES[id]) continue;
    openTab(chrome.runtime.getURL(`upload.html?engine=${encodeURIComponent(id)}`), tab);
  }
}

function capture(tab, mode) {
  if (!tab?.windowId) return;
  chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 86 }, (dataUrl) => {
    if (chrome.runtime.lastError || !dataUrl) return;
    if (mode === "search") {
      void searchBlob(ENGINE_IDS, dataUrl, tab);
      return;
    }
    void tell(tab, { type: "show-capture", dataUrl });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "sg-page") {
    capture(tab, "loupe");
    return;
  }
  if (info.menuItemId === "sg-frame") {
    void tell(tab, { type: "grab-frame" });
    return;
  }
  if (info.menuItemId === "sg-loupe") {
    void tell(tab, { type: "open-url", url: info.srcUrl || "" });
    return;
  }
  const item = SEARCH_ITEMS.find(([id]) => id === info.menuItemId);
  if (!item) return;
  const engines = item[2];
  if (isPublicUrl(info.srcUrl)) searchPublic(engines, info.srcUrl, tab);
  else void tell(tab, { type: "raster-search", engines, url: info.srcUrl || "" });
});

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    if (command === "open-loupe") void tell(tab, { type: "open-last" });
    if (command === "grab-frame") void tell(tab, { type: "grab-frame" });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;
  if (message?.type === "search-public" && isPublicUrl(message.url)) {
    searchPublic(message.engines || [], message.url, tab);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "search-blob" && typeof message.dataUrl === "string") {
    void searchBlob(message.engines || [], message.dataUrl, tab).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: String(error) }),
    );
    return true;
  }
  if (message?.type === "capture-tab") {
    const windowId = tab?.windowId;
    if (windowId == null) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 86 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) sendResponse({ ok: false, error: chrome.runtime.lastError?.message });
      else sendResponse({ ok: true, dataUrl });
    });
    return true;
  }
  return false;
});
