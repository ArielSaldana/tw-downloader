/* ISOLATED world: page messages populate a catalog; only real clicks download. */
(() => {
  const { normalizeMedia, isTwitterPage, imageUrl, thumbnailUrl } =
    globalThis.__TW_DOWNLOADER_MEDIA_V1__;
  const catalog = new Map();
  const controls = new Map();
  let scheduled = false;

  function tweetId(href) {
    try {
      const url = new URL(href, location.href);
      return isTwitterPage(url.href)
        ? url.pathname.match(/\/status\/(\d{1,25})(?:\/|$)/)?.[1]
        : undefined;
    } catch {
      return undefined;
    }
  }

  function pageIds(article) {
    const ids = new Set();
    for (const link of article.querySelectorAll('a[href*="/status/"]')) {
      const id = tweetId(link.href);
      if (id) ids.add(id);
    }
    return ids;
  }

  function icon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  function removeControl(target, control) {
    control.events.abort();
    clearTimeout(control.reset);
    control.host.remove();
    if (control.positioned && target.style.position === "relative")
      target.style.position = control.originalPosition;
    controls.delete(target);
  }

  function mount(target, media) {
    let control = controls.get(target);
    if (control && !control.host.isConnected) {
      removeControl(target, control);
      control = undefined;
    }
    if (control) {
      control.media = media;
      return;
    }
    const host = document.createElement("span");
    host.dataset.twdControls = "";
    if (target.matches(":hover")) host.dataset.visible = "";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position:absolute; top:8px; right:8px; z-index:5; display:block; width:32px; height:32px; margin:0; padding:0; pointer-events:none; font:12px system-ui,sans-serif; }
      button { display:grid; place-items:center; width:32px; height:32px; padding:0; color:white; background:rgba(15,23,20,.7); border:1px solid rgba(255,255,255,.25); border-radius:50%; cursor:pointer; opacity:0; pointer-events:none; transition:opacity .12s; font:18px system-ui,sans-serif; }
      :host([data-visible]) button, :host(:focus-within) button { opacity:1; pointer-events:auto; }
      button:hover { background:rgba(15,23,20,.92); } button:focus-visible { outline:2px solid white; outline-offset:2px; }
      button:disabled { cursor:wait; } svg { display:block; }
      [role=status] { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
      :host([data-error]) [role=status] { top:38px; right:0; width:210px; height:auto; overflow:visible; clip-path:none; white-space:normal; padding:8px 10px; border-radius:6px; background:#291c1c; color:white; line-height:1.4; }
      @media (hover:none) { button { opacity:1; pointer-events:auto; } }
      @media (prefers-reduced-motion:reduce) { button { transition:none; } }
    `;
    const button = document.createElement("button");
    button.type = "button";
    const label = media.kind === "image" ? "Save image" : "Save video";
    button.setAttribute("aria-label", label);
    button.title =
      media.kind === "image"
        ? "Save original-size image"
        : "Save best MP4 quality";
    button.append(icon());
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    shadow.append(style, button, status);
    const originalPosition = target.style.position;
    const positioned = getComputedStyle(target).position === "static";
    if (positioned) target.style.position = "relative";
    const events = new AbortController();
    control = {
      host,
      media,
      events,
      originalPosition,
      positioned,
      reset: null,
    };
    controls.set(target, control);
    target.addEventListener(
      "pointerenter",
      () => {
        host.dataset.visible = "";
      },
      { signal: events.signal },
    );
    target.addEventListener(
      "pointerleave",
      () => {
        delete host.dataset.visible;
      },
      { signal: events.signal },
    );
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted || button.disabled) return;
      clearTimeout(control.reset);
      delete host.dataset.error;
      status.textContent = "Starting download…";
      button.disabled = true;
      try {
        const item = control.media;
        const response = await chrome.runtime.sendMessage({
          type: "DOWNLOAD",
          media: item,
          url: item.variants[0].url,
        });
        if (!response?.ok)
          throw new Error(
            response?.error || "Reload X to reconnect the extension.",
          );
        status.textContent =
          "Download started. Check Chrome’s downloads for progress.";
        button.textContent = "✓";
      } catch (error) {
        host.dataset.error = "";
        status.textContent =
          error.message || "Reload X to reconnect the extension.";
      } finally {
        button.disabled = false;
        control.reset = setTimeout(() => {
          button.replaceChildren(icon());
          delete host.dataset.error;
        }, 2500);
      }
    });
    target.append(host);
  }

  function render() {
    const wanted = new Map();
    for (const article of document.querySelectorAll(
      'article[data-testid="tweet"]',
    )) {
      const ids = pageIds(article);
      const media = [...catalog.values()].filter((item) =>
        ids.has(item.tweetId),
      );
      for (const target of article.querySelectorAll(
        '[data-testid="tweetPhoto"]',
      )) {
        const img = target.querySelector("img");
        const url = imageUrl(img?.currentSrc || img?.src);
        const item = media.find(
          (item) => item.kind === "image" && item.variants[0].url === url,
        );
        if (item) wanted.set(target, item);
      }
      const targets = new Set(
        article.querySelectorAll('[data-testid="videoPlayer"]'),
      );
      for (const video of article.querySelectorAll("video"))
        targets.add(
          video.closest('[data-testid="videoPlayer"]') || video.parentElement,
        );
      const videos = media.filter((item) => item.kind === "video");
      const ownId = tweetId(article.querySelector("time")?.closest("a")?.href);
      const ownVideos = videos.filter((item) => item.tweetId === ownId);
      let index = 0;
      for (const target of targets) {
        const poster =
          target.querySelector("video")?.poster ||
          target.querySelector("img")?.src;
        const thumbnail = thumbnailUrl(poster);
        const matched =
          poster &&
          videos.find(
            (item) =>
              (thumbnail && item.poster === thumbnail) ||
              poster.includes(`/${item.mediaId}/`),
          );
        const item =
          matched ||
          (!poster || targets.size === ownVideos.length
            ? ownVideos[index]
            : undefined);
        if (item) wanted.set(target, item);
        index++;
      }
    }
    for (const [target, control] of controls) {
      const item = wanted.get(target);
      if (
        !item ||
        item.mediaId !== control.media.mediaId ||
        item.tweetId !== control.media.tweetId
      )
        removeControl(target, control);
    }
    for (const [target, item] of wanted) mount(target, item);
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      render();
    }, 150);
  }

  document.addEventListener("twd:media:v1", (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 1024 * 1024)
      return;
    try {
      const items = JSON.parse(event.detail);
      if (!Array.isArray(items)) return;
      for (const input of items.slice(0, 200)) {
        const media = normalizeMedia(input);
        if (!media) continue;
        const key = `${media.tweetId}:${media.mediaId}`;
        const previous = catalog.get(key);
        const combined = normalizeMedia({
          ...media,
          author: media.author || previous?.author,
          text: media.text || previous?.text,
          variants: [...media.variants, ...(previous?.variants || [])],
        });
        catalog.delete(key);
        catalog.set(key, combined);
      }
      while (catalog.size > 150) catalog.delete(catalog.keys().next().value);
      scheduleRender();
    } catch {
      /* Page data must not trigger actions. */
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("popup.html") ||
      message?.type !== "LIST_MEDIA"
    )
      return;
    document.dispatchEvent(new CustomEvent("twd:ready:v1"));
    const ids = new Set();
    const currentId = tweetId(location.href);
    if (currentId) ids.add(currentId);
    for (const article of document.querySelectorAll(
      'article[data-testid="tweet"]',
    ))
      for (const id of pageIds(article)) ids.add(id);
    const media = [...catalog.values()].filter((item) => ids.has(item.tweetId));
    media.sort(
      (a, b) =>
        Number(b.tweetId === currentId) - Number(a.tweetId === currentId),
    );
    respond({ ok: true, media });
  });

  document.dispatchEvent(new CustomEvent("twd:ready:v1"));
  function start() {
    new MutationObserver(scheduleRender).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "poster", "href"],
    });
    scheduleRender();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
