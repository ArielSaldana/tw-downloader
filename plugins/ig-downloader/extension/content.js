/* Instagram DOM adapter: match only media present in the validated catalog. */
(() => {
  const { normalizeMedia, assetKey, postCode } =
    globalThis.__IG_DOWNLOADER_MEDIA_V1__;
  const catalog = new Map(),
    controls = new Map();
  let scheduled = false;
  function pageCodes(scope = document) {
    return new Set(
      [...scope.querySelectorAll("a[href]")]
        .map((link) => postCode(link.href))
        .filter(Boolean),
    );
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
    host.dataset.igdControls = "";
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
        ? "Save highest available image"
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
            response?.error || "Reload Instagram to reconnect the extension.",
          );
        status.textContent =
          "Download started. Check Chrome’s downloads for progress.";
        button.textContent = "✓";
      } catch (error) {
        host.dataset.error = "";
        status.textContent =
          error.message || "Reload Instagram to reconnect the extension.";
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

  function mediaTarget(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) return null;
    for (
      let parent = element.parentElement;
      parent && parent !== document.body;
      parent = parent.parentElement
    ) {
      const size = parent.getBoundingClientRect();
      if (
        size.width >= rect.width * 0.9 &&
        size.height >= rect.height * 0.9 &&
        size.width <= rect.width + 24 &&
        size.height <= rect.height + 24
      )
        return parent;
    }
    return null;
  }
  function render() {
    const wanted = new Map();
    const all = [...catalog.values()];
    for (const element of document.querySelectorAll(
      'article img, article video, main img, main video, [role="main"] img, [role="main"] video, [role="dialog"] img, [role="dialog"] video',
    )) {
      const target = mediaTarget(element);
      if (!target) continue;
      const isVideo = element.tagName === "VIDEO";
      const current = assetKey(element.currentSrc || element.src);
      const poster = isVideo ? assetKey(element.poster) : "";
      let media = all.find(
        (item) =>
          (current &&
            item.variants.some(
              (variant) => assetKey(variant.url) === current,
            )) ||
          item.previews.some((url) => {
            const key = assetKey(url);
            return key && (key === current || key === poster);
          }),
      );
      if (!media && isVideo) {
        const scope = element.closest('article, [role="dialog"]');
        const codes = scope ? pageCodes(scope) : new Set();
        const currentCode = postCode(location.href);
        const rect = element.getBoundingClientRect();
        if (currentCode && rect.bottom > 0 && rect.top < innerHeight)
          codes.add(currentCode);
        const candidates = all.filter(
          (item) => item.kind === "video" && codes.has(item.code),
        );
        if (candidates.length === 1) media = candidates[0];
      }
      if (media) wanted.set(target, media);
    }
    for (const [target, control] of controls) {
      const item = wanted.get(target);
      if (
        !item ||
        item.mediaId !== control.media.mediaId ||
        item.postId !== control.media.postId
      )
        removeControl(target, control);
    }
    for (const [target, media] of wanted) mount(target, media);
  }
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      render();
    }, 150);
  }
  document.addEventListener("igd:media:v1", (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 1024 * 1024)
      return;
    try {
      const items = JSON.parse(event.detail);
      if (!Array.isArray(items)) return;
      for (const input of items.slice(0, 200)) {
        const media = normalizeMedia(input);
        if (!media) continue;
        const key = `${media.postId}:${media.mediaId}`,
          previous = catalog.get(key);
        const merged = normalizeMedia({
          ...media,
          author: media.author || previous?.author,
          text: media.text || previous?.text,
          variants: [...media.variants, ...(previous?.variants || [])],
          previews: [...media.previews, ...(previous?.previews || [])],
        });
        catalog.delete(key);
        catalog.set(key, merged);
      }
      while (catalog.size > 150) catalog.delete(catalog.keys().next().value);
      scheduleRender();
    } catch {
      /* Metadata cannot request a download. */
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("popup.html") ||
      message?.type !== "LIST_MEDIA"
    )
      return;
    document.dispatchEvent(new CustomEvent("igd:ready:v1"));
    const codes = pageCodes();
    const currentCode = postCode(location.href);
    if (currentCode) codes.add(currentCode);
    for (const control of controls.values())
      if (control.host.isConnected) codes.add(control.media.code);
    const media = [...catalog.values()].filter((item) => codes.has(item.code));
    media.sort(
      (a, b) => Number(b.code === currentCode) - Number(a.code === currentCode),
    );
    respond({ ok: true, media });
  });
  document.dispatchEvent(new CustomEvent("igd:ready:v1"));
  function start() {
    new MutationObserver(scheduleRender).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "poster", "href"],
    });
    window.addEventListener("resize", scheduleRender);
    scheduleRender();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
