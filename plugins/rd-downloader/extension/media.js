/* Reddit adapter: pure parsing and strict, shared download validation. */
(() => {
  const ID = /^[a-z0-9]{1,32}$/i;
  const MEDIA_ID = /^[a-z0-9_-]{1,80}$/i;
  const sites = [
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "new.reddit.com",
  ];
  const clean = (value) =>
    typeof value === "string" ? value.replace(/&amp;/g, "&") : "";
  function parsed(value) {
    if (typeof value !== "string" || value.length > 8192) return null;
    try {
      const url = new URL(clean(value));
      return url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.hash
        ? url
        : null;
    } catch {
      return null;
    }
  }
  const isRedditPage = (value) => sites.includes(parsed(value)?.hostname);
  function postId(value) {
    try {
      const url = new URL(value, "https://www.reddit.com");
      return isRedditPage(url.href)
        ? url.pathname.match(
            /\/(?:comments|gallery)\/([a-z0-9]+)(?:\/|$)/i,
          )?.[1] || ""
        : "";
    } catch {
      return "";
    }
  }
  function imageUrl(value) {
    const url = parsed(value);
    return url &&
      ["i.redd.it", "preview.redd.it", "external-preview.redd.it"].includes(
        url.hostname,
      ) &&
      /\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)
      ? url.href
      : null;
  }
  function videoUrl(value) {
    const url = parsed(value);
    if (!url) return null;
    if (
      ["preview.redd.it", "i.redd.it"].includes(url.hostname) &&
      /\.mp4$/i.test(url.pathname)
    )
      return url.href;
    return url.hostname === "v.redd.it" &&
      /^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+(?:\.(?:mp4|mpd))?\/?$/i.test(
        url.pathname,
      ) &&
      !/audio/i.test(url.pathname.split("/").pop())
      ? url.href
      : null;
  }
  function videoBase(value) {
    const url = parsed(value);
    if (url?.hostname !== "v.redd.it") return "";
    const path = url.pathname.replace(/\/$/, "");
    return `https://v.redd.it${/\.(mp4|mpd)$/i.test(path) ? path.slice(0, path.lastIndexOf("/")) : path}/`;
  }
  function trackUrl(value, base) {
    const url = parsed(value);
    return url &&
      videoBase(url.href) === base &&
      /\.(?:mp4|mpd)$/i.test(url.pathname)
      ? url.href
      : null;
  }
  function manifestUrl(value) {
    const base = videoBase(value);
    if (!base) return null;
    const url = new URL(value);
    return `${base}DASHPlaylist.mpd${url.search}`;
  }
  function originalImage(value) {
    const url = parsed(imageUrl(value));
    if (!url) return null;
    if (url.hostname === "preview.redd.it")
      return `https://i.redd.it/${url.pathname
        .split("/")
        .pop()
        .replace(/^.*-v\d+-([a-z0-9]+\.[a-z0-9]+)$/i, "$1")}`;
    return url.href;
  }
  function assetKey(value) {
    const url = parsed(imageUrl(value) || videoUrl(value));
    if (!url) return "";
    return url.hostname === "v.redd.it"
      ? videoBase(url.href)
      : new URL(originalImage(url.href) || url.href).pathname;
  }
  const array = (value) => (Array.isArray(value) ? value : []);
  const dimension = (value) =>
    Number.isInteger(value) && value > 0 && value <= 50000 ? value : 0;
  function normalizeMedia(input) {
    if (
      !input ||
      !ID.test(input.postId || "") ||
      !MEDIA_ID.test(input.mediaId || "") ||
      !["image", "video"].includes(input.kind) ||
      !Array.isArray(input.variants)
    )
      return null;
    const variants = new Map();
    for (const item of input.variants.slice(0, 30)) {
      const url =
        input.kind === "image" ? imageUrl(item?.url) : videoUrl(item?.url);
      if (url)
        variants.set(url, {
          url,
          width: dimension(item.width),
          height: dimension(item.height),
          bitrate: dimension(item.bitrate),
        });
    }
    if (!variants.size) return null;
    const author = /^[A-Za-z0-9_-]{1,64}$/.test(input.author || "")
      ? input.author
      : "";
    return {
      postId: String(input.postId),
      mediaId: String(input.mediaId),
      author,
      kind: input.kind,
      text: String(input.text || "").slice(0, 240),
      isGif: input.isGif === true,
      previews: [
        ...new Set(
          (Array.isArray(input.previews) ? input.previews : [])
            .slice(0, 30)
            .map(imageUrl)
            .filter(Boolean),
        ),
      ],
      variants: [...variants.values()].sort(
        (a, b) =>
          b.width * b.height - a.width * a.height || b.bitrate - a.bitrate,
      ),
    };
  }
  function extractMedia(payload) {
    const found = new Map(),
      seen = new WeakSet(),
      pending = [payload];
    let visited = 0;
    function add(input) {
      const media = normalizeMedia(input);
      if (media) found.set(`${media.postId}:${media.mediaId}`, media);
    }
    while (pending.length && visited++ < 50000 && found.size < 200) {
      const node = pending.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const id = String(node.name || node.id || "").replace(/^t3_/, "");
      // Only post records: never turn comment avatars or link-card previews into posts.
      if (ID.test(id) && (node.permalink || node.title) && !node.body) {
        const source = node.crosspost_parent_list?.[0] || node;
        const context = {
          postId: id,
          author: source.author,
          text: source.title || node.title,
        };
        const previews = array(source.preview?.images)
          .flatMap((image) => [
            image?.source?.url,
            ...array(image?.resolutions).map((item) => item?.url),
          ])
          .filter(Boolean);
        const gallery = source.gallery_data?.items;
        const video =
          source.secure_media?.reddit_video ||
          source.media?.reddit_video ||
          source.preview?.reddit_video_preview;
        if (Array.isArray(gallery)) {
          for (const item of gallery) {
            const data = source.media_metadata?.[item?.media_id];
            if (!data || data.status !== "valid" || !data.s) continue;
            const animated = data.e === "AnimatedImage";
            const url = animated ? data.s.mp4 || data.s.gif : data.s.u;
            const kind = animated && data.s.mp4 ? "video" : "image";
            add({
              ...context,
              mediaId: item.media_id,
              kind,
              isGif: animated,
              previews: array(data.p).map((item) => item?.u),
              variants: [
                {
                  url: kind === "image" ? originalImage(url) : url,
                  width: data.s.x,
                  height: data.s.y,
                },
              ],
            });
          }
        } else if (video) {
          add({
            ...context,
            mediaId: id,
            kind: "video",
            isGif: video.is_gif,
            previews,
            variants: [
              {
                url: video.fallback_url || video.dash_url,
                width: video.width,
                height: video.height,
              },
            ],
          });
        } else {
          const destination = source.url_overridden_by_dest || source.url;
          const animation = source.preview?.images?.[0]?.variants?.mp4?.source;
          if (animation)
            add({
              ...context,
              mediaId: id,
              kind: "video",
              isGif: true,
              previews,
              variants: [animation],
            });
          else if (imageUrl(destination))
            add({
              ...context,
              mediaId: assetKey(destination)
                .split("/")
                .pop()
                .replace(/\.[^.]+$/, ""),
              kind: "image",
              previews,
              variants: [
                {
                  url: originalImage(destination),
                  width: source.preview?.images?.[0]?.source?.width,
                  height: source.preview?.images?.[0]?.source?.height,
                },
              ],
            });
          else if (videoUrl(destination))
            add({
              ...context,
              mediaId: id,
              kind: "video",
              previews,
              variants: [{ url: destination }],
            });
        }
      }
      for (const [key, value] of Object.entries(node))
        if (
          key !== "crosspost_parent_list" &&
          value &&
          typeof value === "object"
        )
          pending.push(value);
    }
    return [...found.values()];
  }
  function imageFormat(variant) {
    const url = new URL(variant.url);
    const format = url.searchParams.get("format");
    return (
      ["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(format)
        ? format
        : url.pathname.split(".").pop()
    ).toUpperCase();
  }
  function filename(media, variant) {
    const safe = normalizeMedia({ ...media, variants: [variant] });
    if (!safe) throw new Error("Invalid Reddit media download.");
    const chosen = safe.variants[0];
    const dimensions = chosen.width ? `_${chosen.width}x${chosen.height}` : "";
    return `reddit/@${safe.author || "unknown"}/reddit_${safe.postId}_${safe.mediaId}${dimensions}.${safe.kind === "video" ? "mp4" : imageFormat(chosen).toLowerCase()}`;
  }
  globalThis.__RD_DOWNLOADER_MEDIA_V1__ = Object.freeze({
    isRedditPage,
    postId,
    imageUrl,
    videoUrl,
    videoBase,
    trackUrl,
    manifestUrl,
    originalImage,
    assetKey,
    normalizeMedia,
    extractMedia,
    filename,
    imageFormat,
    postUrl: (media) => `https://www.reddit.com/comments/${media.postId}/`,
  });
})();
