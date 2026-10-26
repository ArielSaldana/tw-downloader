const instagramMedia = globalThis.__IG_DOWNLOADER_MEDIA_V1__;
globalThis.__MEDIA_SAVER_SITE__ = Object.freeze({
  id: "ig-downloader",
  label: "Instagram",
  title: "Instagram Media Saver",
  folder: "instagram",
  imageLabel: "Highest available image",
  normalizeMedia: instagramMedia.normalizeMedia,
  postId: (media) => media.code,
  postUrl: instagramMedia.postUrl,
  imageFormat: instagramMedia.imageFormat,
});
