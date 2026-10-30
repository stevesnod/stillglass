const status = document.querySelector("#status");
const hover = document.querySelector("#hover");

chrome.storage.local.get({ hover: true }, (stored) => {
  hover.checked = stored.hover !== false;
});

hover.addEventListener("change", () => {
  chrome.storage.local.set({ hover: hover.checked });
});

document.querySelector("#loupe").addEventListener("click", () => send({ type: "open-last" }));
document.querySelector("#frame").addEventListener("click", () => send({ type: "grab-frame" }));
document.querySelector("#page").addEventListener("click", () => capture());

function send(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, message, () => {
      if (chrome.runtime.lastError) {
        status.textContent = "Reload this page once so Stillglass can attach, then try again.";
        return;
      }
      window.close();
    });
  });
}

function capture() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.windowId) return;
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 86 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        status.textContent = "This page can't be captured.";
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "show-capture", dataUrl }, () => {
        if (chrome.runtime.lastError) {
          chrome.storage.session.set({ stillglassImage: dataUrl }, () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("upload.html?engine=view") });
            window.close();
          });
          return;
        }
        window.close();
      });
    });
  });
}
