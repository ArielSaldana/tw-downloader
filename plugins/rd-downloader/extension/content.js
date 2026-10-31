/* Reddit DOM adapter: match only media present in the validated catalog. */
(() => {
  const {
    normalizeMedia,
    assetKey,
    postId,
    imageUrl,
    videoUrl,
    redgifsId,
    originalImage,
  } = globalThis.__RD_DOWNLOADER_MEDIA_V1__;
  const catalog = new Map(),
    controls = new Map();
  let scheduled = false;
  const POST =
    'shreddit-post, .thing[data-fullname^="t3_"], [data-testid="post-container"]';
  let observed = new WeakSet();
  const observer = new MutationObserver(scheduleRender);
  function roots(scope) {
    const result = [scope];
    for (let i = 0; i < result.length && i < 100; i++) {
      const root = result[i];
      if (
        (root === document || root instanceof ShadowRoot) &&
        !observed.has(root)
      ) {
        observed.add(root);
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "src",
            "srcset",
            "poster",
            "href",
            "author",
            "post-id",
            "content-href",
            "permalink",
            "data-author",
            "data-url",
            "data-fullname",
            "packaged-media-json",
            "playback-media-json",
          ],
        });
      }
      for (const node of [...root.querySelectorAll("*")].slice(0, 10000))
        if (node.shadowRoot) result.push(node.shadowRoot);
    }
    return result;
  }
  const query = (scope, selector) =>
    roots(scope).flatMap((root) => [...root.querySelectorAll(selector)]);
  function context(post) {
    const link = post.querySelector(
      'a[data-click-id="comments"], a.comments, a[href*="/comments/"]',
    );
    const id =
      (post.getAttribute("post-id") || post.dataset.fullname || "").replace(
        /^t3_/,
        "",
      ) || postId(post.getAttribute("permalink") || link?.href || "");
    const authorLink = post.querySelector(
      'a.author, [data-testid="post_author_link"]',
    );
    const author =
      post.getAttribute("author") ||
      post.dataset.author ||
      authorLink?.textContent?.replace(/^u\//, "").trim() ||
      "";
    return {
      postId: id,
      author,
      text:
        post.getAttribute("post-title") ||
        post.querySelector('[slot="title"], a.title, h3')?.textContent ||
        "",
    };
  }
  function playerUrls(player) {
    const urls = [player.getAttribute("src")];
    for (const name of ["packaged-media-json", "playback-media-json"]) {
      const value = player.getAttribute(name);
      if (!value || value.length > 100000) continue;
      try {
        const pending = [JSON.parse(value)];
        let visited = 0;
        while (pending.length && visited++ < 1000) {
          const node = pending.pop();
          if (typeof node === "string") urls.push(node);
          else if (node && typeof node === "object")
            pending.push(...Object.values(node));
        }
      } catch {
        /* Optional player metadata. */
      }
    }
    return urls.filter(videoUrl);
  }
  function pageIds() {
    return new Set(
      query(document, POST)
        .map((post) => context(post).postId)
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
      control.host.toggleAttribute(
        "data-embedded",
        Boolean(target.querySelector("iframe")),
      );
      return;
    }
    const host = document.createElement("span");
    host.dataset.rddControls = "";
    // Events inside another origin's iframe do not reliably reach its parent.
    // Keep the small embed control visible so it is always reachable.
    host.toggleAttribute(
      "data-embedded",
      Boolean(target.querySelector("iframe")),
    );
    if (target.matches(":hover")) host.dataset.visible = "";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { position:absolute; top:8px; right:8px; z-index:5; display:block; width:32px; height:32px; margin:0; padding:0; pointer-events:none; font:12px system-ui,sans-serif; }
      button { display:grid; place-items:center; width:32px; height:32px; padding:0; color:white; background:rgba(15,23,20,.7); border:1px solid rgba(255,255,255,.25); border-radius:50%; cursor:pointer; opacity:0; pointer-events:none; transition:opacity .12s; font:18px system-ui,sans-serif; }
      :host([data-visible]) button, :host([data-embedded]) button, :host(:focus-within) button { opacity:1; pointer-events:auto; }
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
            response?.error || "Reload Reddit to reconnect the extension.",
          );
        status.textContent =
          "Download started. Check Chrome’s downloads for progress.";
        button.textContent = "✓";
      } catch (error) {
        host.dataset.error = "";
        status.textContent =
          error.message || "Reload Reddit to reconnect the extension.";
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

  function mediaTarget(element, post) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) return null;
    if (element.matches("shreddit-player"))
      return element.parentElement || post;
    for (
      let parent = element.parentElement;
      parent && parent !== post.parentElement;
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
  let currentMedia = [];
  function render() {
    observer.disconnect();
    observed = new WeakSet();
    const wanted = new Map(),
      visible = new Map();
    const all = [...catalog.values()];
    for (const post of query(document, POST)) {
      const info = context(post);
      if (!info.postId) continue;
      const destination =
        post.getAttribute("content-href") ||
        post.dataset.url ||
        post.querySelector('a.title, a[data-testid="outbound-link"]')?.href;
      const unsupportedLink =
        post.getAttribute("post-type") === "link" &&
        !imageUrl(destination) &&
        !videoUrl(destination);
      const known = all.filter((item) => item.postId === info.postId);
      for (const item of known)
        visible.set(`${item.postId}:${item.mediaId}`, item);
      const players = query(post, "shreddit-player");
      const elements = query(post, "img, video, shreddit-player, iframe");
      for (const element of elements) {
        // Do not put a second button inside a player's shadow tree, or on comments.
        if (element.closest("shreddit-comment, .comment")) continue;
        if (
          !element.matches("shreddit-player") &&
          players.some(
            (player) =>
              player.contains(element) ||
              roots(player).some(
                (root) => root !== player && root.contains(element),
              ),
          )
        )
          continue;
        const target = mediaTarget(element, post);
        if (!target) continue;
        const source =
          element.currentSrc || element.src || element.getAttribute("src");
        const isVideo =
          element.matches("video, shreddit-player, iframe") ||
          Boolean(videoUrl(source) || videoUrl(destination));
        const poster = assetKey(
          element.poster || element.getAttribute("poster"),
        );
        const current = assetKey(source);
        let media = known.find(
          (item) =>
            (current &&
              item.variants.some(
                (variant) => assetKey(variant.url) === current,
              )) ||
            item.previews.some(
              (url) =>
                assetKey(url) && [current, poster].includes(assetKey(url)),
            ),
        );
        if (!media && isVideo) {
          const videos = known.filter((item) => item.kind === "video");
          if (videos.length === 1) media = videos[0];
        }
        const externalClip = redgifsId(destination) || redgifsId(source);
        if (externalClip)
          media = normalizeMedia({
            ...info,
            ...media,
            mediaId: info.postId,
            kind: "video",
            variants: [
              { url: `https://www.redgifs.com/watch/${externalClip}` },
            ],
          });
        if (!media) {
          if (unsupportedLink && !isVideo) continue;
          const urls = isVideo
            ? [
                source,
                ...playerUrls(element),
                ...query(element, "source").map((item) => item.src),
                destination,
              ].filter(videoUrl)
            : [
                originalImage(
                  /\.gif(?:\?|$)/i.test(imageUrl(destination) || "")
                    ? destination
                    : source,
                ),
              ].filter(Boolean);
          const variants = urls.map((url) => ({
            url,
            width: isVideo
              ? Number(element.getAttribute("width"))
              : element.naturalWidth,
            height: isVideo
              ? Number(element.getAttribute("height"))
              : element.naturalHeight,
          }));
          media = normalizeMedia({
            ...info,
            mediaId: isVideo
              ? info.postId
              : assetKey(urls[0])
                  .split("/")
                  .pop()
                  ?.replace(/\.[^.]+$/, ""),
            kind: isVideo ? "video" : "image",
            isGif: post.getAttribute("post-type") === "gif",
            variants,
            previews: [source, element.poster].filter(imageUrl),
          });
        }
        if (media) {
          wanted.set(target, media);
          visible.set(`${media.postId}:${media.mediaId}`, media);
        }
      }
    }
    currentMedia = [...visible.values()];
    for (const [target, control] of controls) {
      const item = wanted.get(target);
      if (
        !item ||
        item.mediaId !== control.media.mediaId ||
        item.postId !== control.media.postId ||
        item.kind !== control.media.kind
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
  document.addEventListener("rdd:media:v1", (event) => {
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
    document.dispatchEvent(new CustomEvent("rdd:ready:v1"));
    render();
    const ids = pageIds();
    const media = currentMedia.filter((item) => ids.has(item.postId));
    respond({ ok: true, media });
  });
  document.dispatchEvent(new CustomEvent("rdd:ready:v1"));
  function start() {
    roots(document);
    // Custom elements can attach shadow roots without a light-DOM mutation.
    setInterval(scheduleRender, 2000);
    window.addEventListener("resize", scheduleRender);
    scheduleRender();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
