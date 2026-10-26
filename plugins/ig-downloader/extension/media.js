/* Instagram adapter: pure parsing; signed CDN query strings stay intact. */
(() => {
  const CODE = /^[A-Za-z0-9_-]{1,40}$/;
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function isInstagramPage(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        ["instagram.com", "www.instagram.com"].includes(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  function mediaUrl(value, kind) {
    if (typeof value !== "string" || value.length > 8192) return null;
    try {
      const url = new URL(value);
      const cdn = ["cdninstagram.com", "fbcdn.net"].some((domain) =>
        url.hostname.endsWith(`.${domain}`),
      );
      const extension = url.pathname
        .match(/\.([a-z0-9]+)$/i)?.[1]
        .toLowerCase();
      const formats =
        kind === "video" ? ["mp4"] : ["jpg", "jpeg", "png", "webp", "avif"];
      if (
        url.protocol !== "https:" ||
        !cdn ||
        url.port ||
        url.username ||
        url.password ||
        url.hash ||
        !formats.includes(extension) ||
        url.searchParams.has("bytestart") ||
        url.searchParams.has("byteend")
      )
        return null;
      return url.href;
    } catch {
      return null;
    }
  }
  const imageUrl = (url) => mediaUrl(url, "image");
  const videoUrl = (url) => mediaUrl(url, "video");
  function assetKey(value) {
    const url = imageUrl(value) || videoUrl(value);
    return url ? new URL(url).pathname.split("/").pop() : "";
  }
  function shortcode(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
    const numeric = String(value ?? "").split("_")[0];
    if (!/^\d{1,30}$/.test(numeric)) return "";
    let number = BigInt(numeric),
      code = "";
    do {
      code = ALPHABET[Number(number % 64n)] + code;
      number /= 64n;
    } while (number > 0n);
    return code;
  }
  function postCode(value) {
    try {
      const url = new URL(value, "https://www.instagram.com");
      return isInstagramPage(url.href)
        ? url.pathname.match(
            /^\/(?:[A-Za-z0-9_.]{1,30}\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{1,40})(?:\/|$)/,
          )?.[1] || ""
        : "";
    } catch {
      return "";
    }
  }
  const dimension = (value) =>
    Number.isInteger(value) && value > 0 && value <= 50000 ? value : 0;
  function normalizeMedia(input) {
    if (
      !input ||
      typeof input !== "object" ||
      !ID.test(String(input.postId ?? "")) ||
      !ID.test(String(input.mediaId ?? "")) ||
      !CODE.test(String(input.code ?? "")) ||
      !["image", "video"].includes(input.kind) ||
      !Array.isArray(input.variants)
    )
      return null;
    const variants = new Map();
    for (const item of input.variants.slice(0, 30)) {
      const url = mediaUrl(item?.url, input.kind);
      if (!url) continue;
      variants.set(url, {
        url,
        width: dimension(item.width),
        height: dimension(item.height),
        bitrate: 0,
      });
    }
    if (!variants.size) return null;
    const previews = [
      ...new Set(
        (Array.isArray(input.previews) ? input.previews : [])
          .slice(0, 30)
          .map(imageUrl)
          .filter(Boolean),
      ),
    ];
    return {
      postId: String(input.postId),
      mediaId: String(input.mediaId),
      code: String(input.code),
      kind: input.kind,
      author: String(input.author ?? "")
        .replace(/[^A-Za-z0-9_.]/g, "")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 30),
      text: String(input.text ?? "").slice(0, 240),
      previews,
      variants: [...variants.values()].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      ),
    };
  }
  function extractMedia(payload) {
    const found = new Map(),
      seen = new WeakSet();
    const pending = [{ node: payload, parent: null }];
    let visited = 0;
    while (pending.length && visited++ < 60000 && found.size < 200) {
      const { node, parent } = pending.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const children =
        node.carousel_media ||
        node.edge_sidecar_to_children?.edges?.map((edge) => edge.node);
      const images = Array.isArray(node.image_versions2?.candidates)
        ? node.image_versions2.candidates
        : [];
      const resources = Array.isArray(node.display_resources)
        ? node.display_resources
        : [];
      const imageVariants = [
        ...images,
        ...resources.map((item) => ({
          url: item.src,
          width: item.config_width,
          height: item.config_height,
        })),
      ];
      if (node.display_url)
        imageVariants.push({
          url: node.display_url,
          width: node.dimensions?.width,
          height: node.dimensions?.height,
        });
      const videos = Array.isArray(node.video_versions)
        ? node.video_versions
        : [];
      const hasMedia =
        children || imageVariants.length || videos.length || node.video_url;
      const rawId = node.id ?? node.pk;
      const code =
        parent?.code ||
        (CODE.test(String(node.code || node.shortcode || ""))
          ? String(node.code || node.shortcode)
          : shortcode(rawId));
      const ownAuthor = node.user?.username || node.owner?.username;
      const context = {
        postId: parent?.postId || String(rawId ?? code).split("_")[0],
        code,
        author: ownAuthor || parent?.author || "",
        text:
          node.caption?.text ||
          (typeof node.caption === "string" ? node.caption : "") ||
          node.edge_media_to_caption?.edges?.[0]?.node?.text ||
          parent?.text ||
          "",
      };
      // Stories and broadcasts have different lifecycles. Don't turn covers or
      // live/segmented streams into misleading downloadable photos or MP4s.
      const unsupported = Boolean(
        node.expiring_at ||
        node.is_story ||
        node.is_live ||
        node.original_media,
      );
      if (hasMedia && code && !unsupported) {
        if (Array.isArray(children) && children.length) {
          for (const child of [...children].reverse())
            pending.push({ node: child, parent: context });
        } else {
          const kind =
            node.media_type === 2 ||
            node.is_video === true ||
            node.__typename === "GraphVideo" ||
            videos.length ||
            node.video_url ||
            node.video_dash_manifest
              ? "video"
              : "image";
          const variants =
            kind === "video"
              ? [
                  ...videos,
                  ...(node.video_url
                    ? [
                        {
                          url: node.video_url,
                          width: node.dimensions?.width || node.original_width,
                          height:
                            node.dimensions?.height || node.original_height,
                        },
                      ]
                    : []),
                ]
              : imageVariants;
          const media = normalizeMedia({
            ...context,
            mediaId: String(rawId ?? `${code}_1`).split("_")[0],
            kind,
            variants,
            previews: imageVariants.map((item) => item.url),
          });
          if (media) found.set(`${media.postId}:${media.mediaId}`, media);
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "carousel_media" || key === "edge_sidecar_to_children")
          continue;
        if (value && typeof value === "object")
          pending.push({ node: value, parent: null });
      }
    }
    return [...found.values()];
  }
  function imageFormat(variant) {
    return new URL(variant.url).pathname.split(".").pop().toUpperCase();
  }
  function filename(media, variant) {
    const safe = normalizeMedia({ ...media, variants: [variant] });
    if (!safe) throw new Error("Invalid Instagram media download.");
    const chosen = safe.variants[0];
    const resolution = chosen.width ? `_${chosen.width}x${chosen.height}` : "";
    const extension =
      safe.kind === "video" ? "mp4" : imageFormat(chosen).toLowerCase();
    return `instagram/@${safe.author || "unknown"}/instagram_${safe.author || safe.kind}_${safe.code}_${safe.mediaId}${resolution}.${extension}`;
  }
  const postUrl = (media) => `https://www.instagram.com/p/${media.code}/`;
  globalThis.__IG_DOWNLOADER_MEDIA_V1__ = Object.freeze({
    isInstagramPage,
    mediaUrl,
    imageUrl,
    videoUrl,
    assetKey,
    shortcode,
    postCode,
    normalizeMedia,
    extractMedia,
    filename,
    imageFormat,
    postUrl,
  });
})();
