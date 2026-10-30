if (globalThis.__stillglassLoaded) {
  /* already injected */
} else {
  globalThis.__stillglassLoaded = true;
  boot();
}

function boot() {
  const LOUPE = 168;
  let hoverEnabled = true;
  let lastImage = null;
  let lastVideo = null;
  let chipHost = null;
  let chipTarget = null;
  let loupeHost = null;
  let loupeState = null;

  chrome.storage.local.get({ hover: true }, (stored) => {
    hoverEnabled = stored.hover !== false;
    if (!hoverEnabled) hideChip();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.hover) return;
    hoverEnabled = changes.hover.newValue !== false;
    if (!hoverEnabled) hideChip();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;
    if (message.type === "ping") {
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "open-last") {
      if (lastImage) openFromImage(lastImage);
      else if (lastVideo) void grabFrame();
      else void capturePage("Hover a photo first, or capture the page.");
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "open-url") {
      const img = message.url ? findImage(message.url) : lastImage;
      if (img) openFromImage(img);
      else if (isPublic(message.url)) openLoupe({ url: message.url, label: "Picture" });
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "grab-frame") {
      void grabFrame();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "show-capture" && message.dataUrl) {
      openLoupe({ dataUrl: message.dataUrl, label: "Visible page" });
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "raster-search") {
      void rasterSearch(message.engines || [], message.url || "");
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  document.addEventListener(
    "mouseover",
    (event) => {
      if (!hoverEnabled) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#stillglass-chip, #stillglass-loupe")) return;
      const img = target.closest("img");
      if (img instanceof HTMLImageElement && largeEnough(img)) {
        lastImage = img;
        showChip(img, "Loupe");
        return;
      }
      const video = target.closest("video");
      if (video instanceof HTMLVideoElement && video.clientWidth >= 160) {
        lastVideo = video;
        showChip(video, "Frame");
        return;
      }
    },
    true,
  );

  document.addEventListener(
    "scroll",
    () => {
      if (chipTarget) placeChip(chipTarget);
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (chipTarget) placeChip(chipTarget);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLoupe();
  });

  function largeEnough(img) {
    const w = img.clientWidth || img.naturalWidth;
    const h = img.clientHeight || img.naturalHeight;
    return w >= 80 && h >= 80;
  }

  function isPublic(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url);
  }

  function findImage(url) {
    for (const img of document.images) {
      if (img.currentSrc === url || img.src === url) return img;
    }
    return null;
  }

  function ensureChip() {
    if (chipHost) return chipHost;
    chipHost = document.createElement("div");
    chipHost.id = "stillglass-chip";
    chipHost.style.position = "fixed";
    chipHost.style.zIndex = "2147483646";
    chipHost.style.display = "none";
    const shadow = chipHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      button {
        font: 600 13px/1 Outfit, "Avenir Next", sans-serif;
        color: #1a1208;
        background: #e8a04a;
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgb(0 0 0 / 0.35);
      }
      button:focus-visible { outline: 2px solid #f3efe6; outline-offset: 2px; }
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Loupe";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = chipTarget;
      hideChip();
      if (target instanceof HTMLImageElement) openFromImage(target);
      else if (target instanceof HTMLVideoElement) {
        lastVideo = target;
        void grabFrame();
      }
    });
    shadow.append(style, button);
    document.documentElement.append(chipHost);
    chipHost.addEventListener("mouseleave", () => hideChip());
    return chipHost;
  }

  function showChip(el, label) {
    const host = ensureChip();
    const button = host.shadowRoot?.querySelector("button");
    if (button) button.textContent = label;
    chipTarget = el;
    host.style.display = "block";
    placeChip(el);
  }

  function placeChip(el) {
    if (!chipHost) return;
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width < 40) {
      chipHost.style.display = "none";
      return;
    }
    const width = 72;
    chipHost.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width - 8))}px`;
    chipHost.style.top = `${Math.max(8, rect.top + 8)}px`;
  }

  function hideChip() {
    chipTarget = null;
    if (chipHost) chipHost.style.display = "none";
  }

  function openFromImage(img) {
    lastImage = img;
    const url = img.currentSrc || img.src;
    if (isPublic(url)) {
      openLoupe({ url, label: "Picture" });
      return;
    }
    const dataUrl = raster(img);
    if (dataUrl) openLoupe({ dataUrl, label: "Picture" });
    else openLoupe({ url, label: "Picture", locked: true });
  }

  function raster(source) {
    const width = source.naturalWidth || source.videoWidth || source.width;
    const height = source.naturalHeight || source.videoHeight || source.height;
    if (!width || !height) return null;
    const longest = Math.max(width, height);
    const scale = longest > 8192 ? 8192 / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      return null;
    }
  }

  async function grabFrame() {
    const video =
      (chipTarget instanceof HTMLVideoElement && chipTarget) ||
      lastVideo ||
      document.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      lastVideo = video;
      const dataUrl = raster(video);
      if (dataUrl) {
        openLoupe({ dataUrl, label: "Video frame" });
        return;
      }
    }
    await capturePage("The player hid its frames, so this is the visible page.");
  }

  function capturePage(note) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "capture-tab" }, (res) => {
        if (res?.dataUrl) openLoupe({ dataUrl: res.dataUrl, label: "Visible page", note });
        resolve();
      });
    });
  }

  async function rasterSearch(engines, url) {
    const img = url ? findImage(url) : lastImage;
    const dataUrl = img ? raster(img) : null;
    if (dataUrl) {
      chrome.runtime.sendMessage({ type: "search-blob", engines, dataUrl });
      return;
    }
    await capturePage("That picture couldn't be copied. Trace the visible page if it's the one you want.");
  }

  function closeLoupe() {
    loupeHost?.remove();
    loupeHost = null;
    loupeState = null;
  }

  function openLoupe(source) {
    closeLoupe();
    hideChip();
    loupeState = {
      url: source.url || "",
      dataUrl: source.dataUrl || "",
      locked: Boolean(source.locked),
      brightness: 1,
      contrast: 1,
      saturation: 1,
      warmth: 0,
      rotate: 0,
      flipX: false,
      flipY: false,
      zoom: 1,
      panX: 0,
      panY: 0,
    };

    loupeHost = document.createElement("div");
    loupeHost.id = "stillglass-loupe";
    loupeHost.style.position = "fixed";
    loupeHost.style.inset = "0";
    loupeHost.style.zIndex = "2147483647";
    const shadow = loupeHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = panelCss();
    const back = document.createElement("div");
    back.className = "back";
    back.addEventListener("click", (event) => {
      if (event.target === back) closeLoupe();
    });

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Stillglass");

    const header = document.createElement("header");
    const title = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = "Stillglass";
    const label = document.createElement("span");
    label.textContent = source.label || "Picture";
    title.append(name, label);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", closeLoupe);
    header.append(title, close);

    const stage = document.createElement("div");
    stage.className = "stage";
    const photo = document.createElement("img");
    photo.alt = source.label || "Picture";
    photo.draggable = false;
    photo.src = source.dataUrl || source.url || "";
    const useFullSize = () => {
      const width = photo.naturalWidth;
      const height = photo.naturalHeight;
      if (!width || !height) return;
      photo.style.width = `${width}px`;
      photo.style.height = `${height}px`;
    };
    photo.addEventListener("load", useFullSize);
    if (photo.complete) useFullSize();
    stage.append(photo);
    const zoomBar = document.createElement("div");
    zoomBar.className = "zoombar";
    const zoomOut = document.createElement("button");
    zoomOut.type = "button";
    zoomOut.textContent = "−";
    zoomOut.title = "Zoom out";
    const zoomLabel = document.createElement("span");
    zoomLabel.textContent = "100%";
    const zoomIn = document.createElement("button");
    zoomIn.type = "button";
    zoomIn.textContent = "+";
    zoomIn.title = "Zoom in";
    zoomOut.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomCenter(1 / 1.35);
    });
    zoomIn.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomCenter(1.35);
    });
    zoomBar.append(zoomOut, zoomLabel, zoomIn);
    stage.append(zoomBar);
    stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89);
      },
      { passive: false },
    );
    stage.addEventListener("dblclick", (event) => {
      event.preventDefault();
      loupeState.zoom = 1;
      loupeState.panX = 0;
      loupeState.panY = 0;
      paint();
    });
    let drag = null;
    let moved = false;
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      moved = false;
      drag = {
        x: event.clientX,
        y: event.clientY,
        panX: loupeState.panX,
        panY: loupeState.panY,
      };
      stage.classList.add("dragging");
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) moved = true;
      loupeState.panX = drag.panX + (event.clientX - drag.x);
      loupeState.panY = drag.panY + (event.clientY - drag.y);
      paint();
    });
    const endDrag = (event) => {
      const wasClick = Boolean(drag) && !moved;
      drag = null;
      moved = false;
      stage.classList.remove("dragging");
      if (wasClick && event) zoomInto(event.clientX, event.clientY);
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", () => {
      drag = null;
      moved = false;
      stage.classList.remove("dragging");
    });

    const tune = document.createElement("div");
    tune.className = "tune";
    const sliders = [
      ["Brightness", "brightness", 0.4, 2],
      ["Contrast", "contrast", 0.4, 2],
      ["Color", "saturation", 0, 2],
      ["Warmth", "warmth", 0, 1],
    ];
    for (const [sliderLabel, key, min, max] of sliders) {
      const row = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = sliderLabel;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = "0.01";
      input.value = String(loupeState[key]);
      input.addEventListener("input", () => {
        loupeState[key] = Number(input.value);
        paint();
      });
      row.append(span, input);
      tune.append(row);
    }

    const tools = document.createElement("div");
    tools.className = "tools";
    tools.append(
      tool("Rotate", () => {
        loupeState.rotate = (loupeState.rotate + 90) % 360;
        paint();
      }),
      tool("Flip", () => {
        loupeState.flipX = !loupeState.flipX;
        paint();
      }),
      tool("Save", () => {
        void saveStill();
      }),
      tool("Reset", () => {
        Object.assign(loupeState, {
          brightness: 1,
          contrast: 1,
          saturation: 1,
          warmth: 0,
          rotate: 0,
          flipX: false,
          flipY: false,
          zoom: 1,
          panX: 0,
          panY: 0,
        });
        tune.querySelectorAll("input").forEach((input) => {
          const key = sliders.find((item) => item[0] === input.parentElement?.querySelector("span")?.textContent);
          if (key) input.value = String(loupeState[key[1]]);
        });
        paint();
      }),
    );

    const trace = document.createElement("div");
    trace.className = "trace";
    const engines = [
      ["google", "Google Lens"],
      ["tineye", "TinEye"],
      ["yandex", "Yandex"],
      ["bing", "Bing"],
    ];
    for (const [id, engineLabel] of engines) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = engineLabel;
      button.addEventListener("click", () => traceStill([id]));
      trace.append(button);
    }
    const all = document.createElement("button");
    all.type = "button";
    all.className = "all";
    all.textContent = "All four";
    all.addEventListener("click", () => traceStill(engines.map(([id]) => id)));
    trace.append(all);

    const status = document.createElement("p");
    status.className = "status";
    status.textContent =
      source.note ||
      (source.locked
        ? "This picture's pixels are locked. Tracing will use a capture of the page."
        : "Drag the picture to frame a spot, then click that spot to zoom into it.");

    panel.append(header, stage, tune, tools, trace, status);
    back.append(panel);
    shadow.append(style, back);
    document.documentElement.append(loupeHost);
    close.focus();
    paint();

    function paint() {
      const sepia = (loupeState.warmth * 0.55).toFixed(3);
      const hue = (-18 * loupeState.warmth).toFixed(2);
      photo.style.filter = `brightness(${loupeState.brightness}) contrast(${loupeState.contrast}) saturate(${loupeState.saturation}) sepia(${sepia}) hue-rotate(${hue}deg)`;
      const sx = loupeState.flipX ? -1 : 1;
      photo.style.transform = `translate(${loupeState.panX}px, ${loupeState.panY}px) scale(${loupeState.zoom * sx}, ${loupeState.zoom}) rotate(${loupeState.rotate}deg)`;
      zoomLabel.textContent = `${Math.round(loupeState.zoom * 100)}%`;
    }

    function zoomCenter(factor) {
      const rect = stage.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }

    function zoomInto(clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const current = loupeState.zoom || 1;
      const next = clamp(current === 1 ? 2.4 : current * 1.7, 1, 8);
      const lx = (clientX - originX - loupeState.panX) / current;
      const ly = (clientY - originY - loupeState.panY) / current;
      loupeState.zoom = next;
      loupeState.panX = -lx * next;
      loupeState.panY = -ly * next;
      paint();
    }

    async function saveStill() {
      status.textContent = "Saving…";
      const filename = stampName();
      let dataUrl = "";
      try {
        dataUrl = await tunedDataUrl(photo, loupeState);
      } catch {
        dataUrl = loupeState.dataUrl || "";
      }
      chrome.runtime.sendMessage(
        {
          type: "save-image",
          dataUrl,
          url: dataUrl ? "" : loupeState.url,
          filename,
        },
        (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            status.textContent = res?.error || "Couldn't save. Open Stillglass and choose a folder.";
            return;
          }
          status.textContent = `Saved to ${res.where}.`;
        },
      );
    }

    function zoomAt(clientX, clientY, factor) {
      const rect = stage.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height / 2;
      const current = loupeState.zoom || 1;
      const next = clamp(current * factor, 1, 8);
      if (next <= 1) {
        loupeState.zoom = 1;
        loupeState.panX = 0;
        loupeState.panY = 0;
      } else {
        const ratio = next / current;
        const dx = clientX - originX;
        const dy = clientY - originY;
        loupeState.panX = dx * (1 - ratio) + loupeState.panX * ratio;
        loupeState.panY = dy * (1 - ratio) + loupeState.panY * ratio;
        loupeState.zoom = next;
      }
      paint();
    }

    function traceStill(ids) {
      if (isPublic(loupeState.url) && !loupeState.dataUrl) {
        chrome.runtime.sendMessage({ type: "search-public", engines: ids, url: loupeState.url });
        status.textContent = "Opened the original address. Tuning stays on this page.";
        return;
      }
      if (loupeState.locked && !loupeState.dataUrl) {
        void capturePage("Captured the visible page. Trace it from the new loupe.");
        return;
      }
      chrome.runtime.sendMessage(
        { type: "search-blob", engines: ids, dataUrl: loupeState.dataUrl },
        () => {
          status.textContent = "Sending this still to the engine you picked.";
        },
      );
    }
  }

  function tool(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function stampName() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `stillglass-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.jpg`;
  }

  function tunedDataUrl(img, state) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return Promise.reject(new Error("empty"));
    const canvas = document.createElement("canvas");
    const quarter = state.rotate % 180 !== 0;
    canvas.width = quarter ? height : width;
    canvas.height = quarter ? width : height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("draw"));
    const sepia = (state.warmth * 0.55).toFixed(3);
    const hue = (-18 * state.warmth).toFixed(2);
    ctx.filter = `brightness(${state.brightness}) contrast(${state.contrast}) saturate(${state.saturation}) sepia(${sepia}) hue-rotate(${hue}deg)`;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((state.rotate * Math.PI) / 180);
    ctx.scale(state.flipX ? -1 : 1, state.flipY ? -1 : 1);
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function panelCss() {
    return `
      * { box-sizing: border-box; }
      .back {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgb(18 17 14 / 0.72);
        font-family: Outfit, "Avenir Next", sans-serif;
        color: #f3efe6;
      }
      .panel {
        width: min(1280px, 100%);
        height: min(94vh, 980px);
        max-height: 94vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border: 1px solid #3a342c;
        border-radius: 16px;
        background: #1c1a16;
      }
      header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
      header strong { font-family: Georgia, serif; font-size: 22px; font-weight: 560; }
      header span { display: block; color: #a39b8c; font-size: 13px; }
      button {
        min-height: 40px;
        border: 1px solid #3a342c;
        border-radius: 8px;
        background: transparent;
        color: #f3efe6;
        padding: 0 12px;
        cursor: pointer;
        font: inherit;
      }
      button.all, .trace button.all { background: #e8a04a; color: #1a1208; border-color: #e8a04a; font-weight: 600; }
      .stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: #12110e;
        cursor: grab;
        touch-action: none;
      }
      .stage.dragging { cursor: grabbing; }
      .stage img {
        flex: none;
        max-width: none;
        max-height: none;
        width: auto;
        height: auto;
        user-select: none;
      }
      .zoombar {
        position: absolute;
        left: 8px;
        bottom: 8px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        border-radius: 8px;
        background: rgb(18 17 14 / 0.92);
      }
      .zoombar button { min-width: 36px; min-height: 36px; padding: 0; }
      .zoombar span { min-width: 52px; text-align: center; font-size: 12px; color: #a39b8c; }
      .tune { display: grid; gap: 8px; }
      .tune label { display: grid; grid-template-columns: 92px 1fr; gap: 8px; align-items: center; font-size: 13px; }
      .tune input { width: 100%; accent-color: #e8a04a; }
      .tools, .trace { display: flex; flex-wrap: wrap; gap: 8px; }
      .status { min-height: 2.5em; margin: 0; color: #a39b8c; font-size: 13px; }
    `;
  }
}
