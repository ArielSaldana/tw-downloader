/* MAIN world: observe X's own responses, never request data or read credentials. */
(() => {
  if (window.__TW_DOWNLOADER_OBSERVER_V1__) return;
  window.__TW_DOWNLOADER_OBSERVER_V1__ = true;
  const { extractMedia } = globalThis.__TW_DOWNLOADER_MEDIA_V1__;
  const cache = new Map();
  const DATA = "twd:media:v1";
  const READY = "twd:ready:v1";
  const MAX_BODY = 8 * 1024 * 1024;

  function publish(items) {
    if (items.length)
      document.dispatchEvent(
        new CustomEvent(DATA, { detail: JSON.stringify(items) }),
      );
  }

  function capture(data) {
    const items = extractMedia(data);
    for (const media of items) {
      const key = `${media.tweetId}:${media.mediaId}`;
      cache.delete(key);
      cache.set(key, media);
    }
    while (cache.size > 150) cache.delete(cache.keys().next().value);
    publish(items);
  }

  function isApi(value) {
    try {
      const url = new URL(value, location.href);
      return (
        url.protocol === "https:" &&
        [
          "x.com",
          "www.x.com",
          "twitter.com",
          "www.twitter.com",
          "api.x.com",
          "api.twitter.com",
        ].includes(url.hostname) &&
        /\/(?:i\/api\/)?(?:graphql|1\.1|2)\//.test(url.pathname)
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
            !(response.headers.get("content-type") || "").includes("json")
          )
            return;
          if (Number(response.headers.get("content-length")) > MAX_BODY) return;
          response
            .clone()
            .text()
            .then((body) => {
              if (body.length <= MAX_BODY) capture(JSON.parse(body));
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
            capture(JSON.parse(this.responseText));
          }
        } catch {
          /* Non-JSON responses must not interfere with X. */
        }
      });
    }
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  document.addEventListener(READY, () => publish([...cache.values()]));
  function initialData() {
    try {
      if (window.__INITIAL_STATE__) capture(window.__INITIAL_STATE__);
    } catch {
      /* Optional data. */
    }
    for (const script of document.querySelectorAll(
      'script[type="application/json"]',
    )) {
      try {
        if (script.textContent.length <= MAX_BODY)
          capture(JSON.parse(script.textContent));
      } catch {
        /* Not tweet JSON. */
      }
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialData, { once: true });
  else initialData();
})();
