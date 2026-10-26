importScripts("media.js");

const { normalizeMedia, filename, isTwitterPage } =
  globalThis.__TW_DOWNLOADER_MEDIA_V1__;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "DOWNLOAD") return;
  const popupUrl = chrome.runtime.getURL("popup.html");
  const trusted =
    sender.id === chrome.runtime.id &&
    (sender.url === popupUrl ||
      (sender.tab && sender.frameId === 0 && isTwitterPage(sender.url)));
  if (!trusted) {
    respond({ ok: false, error: "Download request rejected." });
    return;
  }
  const media = normalizeMedia(message.media);
  const variant = media?.variants.find((item) => item.url === message.url);
  if (!media || !variant) {
    respond({
      ok: false,
      error: "Only detected Twitter videos and images can be saved.",
    });
    return;
  }
  chrome.downloads
    .download({
      url: variant.url,
      filename: filename(media, variant),
      conflictAction: "uniquify",
      saveAs: false,
    })
    .then((id) => respond({ ok: true, id }))
    .catch((error) =>
      respond({
        ok: false,
        error: error.message || "Chrome could not start the download.",
      }),
    );
  return true;
});
