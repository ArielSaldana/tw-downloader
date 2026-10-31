const redditMedia = globalThis.__RD_DOWNLOADER_MEDIA_V1__;
globalThis.__MEDIA_SAVER_SITE__ = Object.freeze({
  id: "rd-downloader",
  label: "Reddit",
  title: "Reddit Media Saver",
  folder: "reddit",
  imageLabel: "Original image",
  normalizeMedia: redditMedia.normalizeMedia,
  postId: (media) => media.postId,
  postUrl: redditMedia.postUrl,
  imageFormat: redditMedia.imageFormat,
});
