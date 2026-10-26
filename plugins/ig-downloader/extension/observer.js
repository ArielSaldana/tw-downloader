/* MAIN world: observe Instagram's own responses, never request data or read credentials. */
(() => {
  if (window.__IG_DOWNLOADER_OBSERVER_V1__) return;
  window.__IG_DOWNLOADER_OBSERVER_V1__ = true;
  const { extractMedia } = globalThis.__IG_DOWNLOADER_MEDIA_V1__;
  const cache = new Map();
  const DATA = "igd:media:v1";
  const READY = "igd:ready:v1";
  const MAX_BODY = 8 * 1024 * 1024;

  function publish(items) {
    for (const item of items)
      document.dispatchEvent(
        new CustomEvent(DATA, { detail: JSON.stringify([item]) }),
      );
  }

  function capture(data) {
    const items = extractMedia(data);
    for (const media of items) {
      const key = `${media.postId}:${media.mediaId}`;
      cache.delete(key);
      cache.set(key, media);
    }
    while (cache.size > 150) cache.delete(cache.keys().next().value);
    publish(items);
  }

  function captureText(body) {
    const text = body.replace(/^for\s*\(;;\);\s*/, "");
    try {
      capture(JSON.parse(text));
    } catch {
      for (const line of text.split("\n").slice(0, 100)) {
        try {
          capture(JSON.parse(line));
        } catch {}
      }
    }
  }

  function isApi(value) {
    try {
      const url = new URL(value, location.href);
      return (
        url.protocol === "https:" &&
        ["instagram.com", "www.instagram.com", "i.instagram.com"].includes(
          url.hostname,
        ) &&
        /^\/(?:api\/v1\/|graphql\/|api\/graphql)/.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    const address =
      typeof args[0] === "string" || args[0] instanceof URL
        ? String(args[0])
        : args[0]?.url;
    if (isApi(address)) {
      result
        .then((response) => {
          if (
            !response.ok ||
            !/(?:json|javascript)/.test(
              response.headers.get("content-type") || "",
            )
          )
            return;
          if (Number(response.headers.get("content-length")) > MAX_BODY) return;
          response
            .clone()
            .text()
            .then((body) => {
              if (body.length <= MAX_BODY) captureText(body);
            })
            .catch(() => {});
        })
        .catch(() => {});
    }
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const observedXhrs = new WeakSet();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    // A single listener also handles XHR objects reused with open().
    if (!observedXhrs.has(this)) {
      observedXhrs.add(this);
      this.addEventListener("load", () => {
        if (!isApi(this.responseURL) || this.status < 200 || this.status >= 300)
          return;
        try {
          if (this.responseType === "json") capture(this.response);
          else if (
            (!this.responseType || this.responseType === "text") &&
            this.responseText.length <= MAX_BODY
          ) {
            captureText(this.responseText);
          }
        } catch {
          /* Non-JSON responses must not interfere with Instagram. */
        }
      });
    }
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  document.addEventListener(READY, () => publish([...cache.values()]));
  const parsedScripts = new WeakSet();
  const initialObjects = new WeakSet();
  function initialData() {
    try {
      if (
        window._sharedData &&
        typeof window._sharedData === "object" &&
        !initialObjects.has(window._sharedData)
      ) {
        initialObjects.add(window._sharedData);
        capture(window._sharedData);
      }
    } catch {
      /* Optional data. */
    }
    for (const script of document.querySelectorAll(
      'script[type="application/json"]',
    )) {
      try {
        if (parsedScripts.has(script) || !script.textContent.trim()) continue;
        parsedScripts.add(script);
        if (script.textContent.length <= MAX_BODY)
          capture(JSON.parse(script.textContent));
      } catch {
        /* Not post JSON. */
      }
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialData, { once: true });
  else initialData();
  let pendingScan = false;
  new MutationObserver(() => {
    if (pendingScan) return;
    pendingScan = true;
    setTimeout(() => {
      pendingScan = false;
      initialData();
    }, 200);
  }).observe(document.documentElement || document, {
    childList: true,
    subtree: true,
  });
})();
