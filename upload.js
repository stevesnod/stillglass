import { ENGINES } from "./engines.js";

const params = new URLSearchParams(location.search);
const engineId = params.get("engine") || "view";
const engine = ENGINES[engineId];
const preview = document.querySelector("#preview");
const status = document.querySelector("#status");
const open = document.querySelector("#open");
const copyButton = document.querySelector("#copy");
const title = document.querySelector("#title");

if (engine) title.textContent = engine.label;
else title.textContent = "Visible page";

const stored = await chrome.storage.session.get("stillglassImage");
const dataUrl = stored.stillglassImage;

if (!dataUrl) {
  status.textContent = "The still expired. Capture it again from the page.";
} else {
  preview.src = dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  await copyImage(blob);

  if (engine?.upload === "bing") {
    status.textContent = "Sending the still to Bing…";
    submitBing(dataUrl);
  } else if (engine?.upload === "yandex") {
    status.textContent = "Sending the still to Yandex…";
    const landed = await submitYandex(blob);
    if (!landed) showPaste(engine);
  } else if (engine) {
    showPaste(engine);
  } else {
    status.textContent = "The page wouldn't host the loupe, so the capture is here. Copy it into a search engine.";
    open.hidden = false;
    open.textContent = "Open Google Lens";
    open.addEventListener("click", () => chrome.tabs.create({ url: ENGINES.google.home }));
  }

  copyButton.addEventListener("click", () => void copyImage(blob));
}

function showPaste(target) {
  status.textContent = `Copied the still. Paste it on ${target.label} with Ctrl+V or \u2318V.`;
  open.hidden = false;
  open.textContent = `Open ${target.label}`;
  open.addEventListener("click", () => chrome.tabs.create({ url: target.home }));
  chrome.tabs.create({ url: target.home });
}

async function copyImage(blob) {
  try {
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    status.textContent = "Couldn't copy automatically. Right-click the preview and copy the image.";
    return false;
  }
}

function toPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("draw"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("blob"))), "image/png");
    };
    img.onerror = () => reject(new Error("load"));
    img.src = URL.createObjectURL(blob);
  });
}

function submitBing(url) {
  const payload = url.slice(url.indexOf(",") + 1);
  const form = document.createElement("form");
  form.method = "POST";
  form.action =
    "https://www.bing.com/images/search?view=detailv2&iss=sbiupload&FORM=SBIHMP&sbifnm=still.jpg";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "imageBin";
  input.value = payload;
  form.append(input);
  document.body.append(form);
  form.submit();
}

async function submitYandex(blob) {
  const hosts = ["yandex.com", "yandex.ru"];
  for (const host of hosts) {
    const endpoint =
      `https://${host}/images/touch/search?rpt=imageview&format=json&request=` +
      encodeURIComponent(JSON.stringify({ blocks: [{ block: "cbir-uploader__get-cbir-id" }] }));
    const body = new FormData();
    body.append("upfile", blob, "still.jpg");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
      });
      if (!response.ok) continue;
      const json = await response.json();
      const params = findCbir(json);
      if (!params?.cbirId) continue;
      const next = `https://${host}/images/search?cbir_id=${encodeURIComponent(params.cbirId)}&rpt=imageview&url=${encodeURIComponent(params.originalImageUrl || "")}`;
      location.replace(next);
      return true;
    } catch {
      /* try the other host */
    }
  }
  return false;
}

function findCbir(json) {
  const blocks = json && json.blocks;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if (block?.params?.cbirId) return block.params;
  }
  return null;
}
