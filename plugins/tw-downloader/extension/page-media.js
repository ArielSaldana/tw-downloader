/* Shared, dependency-free parsing. Page data is untrusted in every context. */
(() => {
  const ID = /^\d{1,25}$/;
  const HOSTS = new Set([
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
  ]);

  function isTwitterPage(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && HOSTS.has(url.hostname) && !url.port;
    } catch {
      return false;
    }
  }

  function videoUrl(value) {
    if (typeof value !== "string" || value.length > 4096) return null;
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "video.twimg.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        !/^\/[a-zA-Z0-9_./%-]+\.mp4$/.test(url.pathname)
      )
        return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function imageUrl(value) {
    if (typeof value !== "string" || value.length > 4096) return null;
    try {
      const url = new URL(value);
      const match = url.pathname.match(
        /^\/media\/([a-zA-Z0-9_-]+)(?:\.(jpg|jpeg|png|webp))?$/,
      );
      const format = (
        url.searchParams.get("format") ||
        match?.[2] ||
        ""
      ).toLowerCase();
      if (
        url.protocol !== "https:" ||
        url.hostname !== "pbs.twimg.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        !match ||
        !["jpg", "jpeg", "png", "webp"].includes(format)
      )
        return null;
      url.pathname = `/media/${match[1]}`;
      url.search = "";
      url.searchParams.set("format", format === "jpeg" ? "jpg" : format);
      url.searchParams.set("name", "orig");
      return url.href;
    } catch {
      return null;
    }
  }

  function thumbnailUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.hostname === "pbs.twimg.com" &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[a-zA-Z0-9_./%-]+\.(?:jpg|png|webp)$/.test(
          url.pathname,
        )
        ? url.origin + url.pathname
        : "";
    } catch {
      return "";
    }
  }

  function normalizeMedia(input) {
    if (!input || typeof input !== "object") return null;
    const tweetId = String(input.tweetId ?? "");
    const mediaId = String(input.mediaId ?? "");
    const kind = input.kind ?? "video";
    if (
      !ID.test(tweetId) ||
      !ID.test(mediaId) ||
      !Array.isArray(input.variants) ||
      !["video", "image"].includes(kind)
    )
      return null;
    const variants = new Map();
    for (const item of input.variants.slice(0, 30)) {
      const url = kind === "image" ? imageUrl(item?.url) : videoUrl(item?.url);
      if (
        !url ||
        (kind === "video" &&
          item.content_type &&
          item.content_type !== "video/mp4")
      )
        continue;
      const dimensions = new URL(url).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
      const imageDimension = (value) =>
        Number.isInteger(value) && value > 0 && value <= 50000 ? value : 0;
      const width =
        kind === "image"
          ? imageDimension(item.width)
          : dimensions
            ? Number(dimensions[1])
            : 0;
      const height =
        kind === "image"
          ? imageDimension(item.height)
          : dimensions
            ? Number(dimensions[2])
            : 0;
      const bitrate =
        Number.isFinite(item.bitrate) && item.bitrate > 0
          ? Math.min(item.bitrate, 1e9)
          : 0;
      variants.set(url, { url, bitrate, width, height });
    }
    if (!variants.size) return null;
    return {
      tweetId,
      mediaId,
      kind,
      poster: kind === "video" ? thumbnailUrl(input.poster) : "",
      author: String(input.author ?? "")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .slice(0, 30),
      text: String(input.text ?? "").slice(0, 240),
      variants: [...variants.values()].sort(
        (a, b) =>
          b.width * b.height - a.width * a.height || b.bitrate - a.bitrate,
      ),
    };
  }

  function extractMedia(payload) {
    const found = new Map();
    const seen = new WeakSet();
    const handledLegacies = new WeakSet();
    const pending = [payload];
    let visited = 0;
    while (pending.length && visited++ < 60000 && found.size < 200) {
      const node = pending.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const legacy = node.legacy ?? node;
      const tweetId = node.rest_id ?? legacy.id_str;
      const media = legacy.extended_entities?.media ?? legacy.entities?.media;
      const isRetweet = Boolean(
        node.retweeted_status_result ||
        legacy.retweeted_status_result ||
        node.retweeted_status ||
        legacy.retweeted_status,
      );
      // A retweet can repeat the original's media under the reposter's ID.
      // Extract the nested original instead, and don't reprocess its legacy
      // object without the parent author metadata.
      const handled = handledLegacies.has(node);
      if (
        node.legacy &&
        typeof node.legacy === "object" &&
        ID.test(String(tweetId))
      ) {
        handledLegacies.add(node.legacy);
      }
      if (
        !handled &&
        !isRetweet &&
        ID.test(String(tweetId)) &&
        Array.isArray(media)
      ) {
        const user = node.core?.user_results?.result;
        const author =
          user?.core?.screen_name ??
          user?.legacy?.screen_name ??
          legacy.user?.screen_name;
        for (const item of media) {
          const normalized = normalizeMedia({
            tweetId,
            mediaId: item.id_str ?? item.id,
            author,
            text: legacy.full_text ?? legacy.text,
            poster: item.media_url_https,
            kind: item.type === "photo" ? "image" : "video",
            variants:
              item.type === "photo"
                ? [
                    {
                      url: item.media_url_https,
                      width: item.original_info?.width,
                      height: item.original_info?.height,
                    },
                  ]
                : item.video_info?.variants,
          });
          if (normalized) {
            const key = `${normalized.tweetId}:${normalized.mediaId}`;
            const previous = found.get(key);
            found.set(
              key,
              normalizeMedia({
                ...normalized,
                author: normalized.author || previous?.author,
                text: normalized.text || previous?.text,
                variants: [
                  ...normalized.variants,
                  ...(previous?.variants || []),
                ],
              }),
            );
          }
        }
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") pending.push(value);
      }
    }
    return [...found.values()];
  }

  function filename(media, variant) {
    const safe = normalizeMedia({ ...media, variants: [variant] });
    if (!safe) throw new Error("Invalid media download.");
    const quality = safe.variants[0];
    const resolution = quality.width
      ? `_${quality.width}x${quality.height}`
      : "";
    const extension =
      safe.kind === "image"
        ? new URL(quality.url).searchParams.get("format")
        : "mp4";
    return `twitter/@${safe.author || "unknown"}/twitter_${safe.author || safe.kind}_${safe.tweetId}_${safe.mediaId}${resolution}.${extension}`;
  }

  globalThis.__TW_DOWNLOADER_MEDIA_V1__ = Object.freeze({
    isTwitterPage,
    videoUrl,
    imageUrl,
    thumbnailUrl,
    normalizeMedia,
    extractMedia,
    filename,
  });
})();
