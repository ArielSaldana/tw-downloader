globalThis.__MEDIA_SAVER_SITE__ = Object.freeze({
  id: "tw-downloader",
  label: "X/Twitter",
  title: "Twitter Media Saver",
  folder: "twitter",
  imageLabel: "Original-size image",
  normalizeMedia: globalThis.__TW_DOWNLOADER_MEDIA_V1__.normalizeMedia,
  postId: (media) => media.tweetId,
  postUrl: (media) => `https://x.com/i/status/${media.tweetId}`,
  imageFormat: (variant) =>
    new URL(variant.url).searchParams.get("format").toUpperCase(),
});
