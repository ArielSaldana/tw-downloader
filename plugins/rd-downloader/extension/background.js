importScripts("media.js", "redgifs.js");
const { normalizeMedia, filename, isRedditPage, redgifsId } =
  globalThis.__RD_DOWNLOADER_MEDIA_V1__;
let creating;
async function offscreen() {
  if (!creating)
    creating = (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("offscreen.html")],
      });
      if (!contexts.length)
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["BLOBS"],
          justification:
            "Combine Reddit video and audio locally and hold the MP4 blob until Chrome finishes saving it.",
        });
    })().finally(() => {
      creating = null;
    });
  return creating;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const internal =
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("offscreen.html") &&
    !sender.tab;
  if (message?.type === "DOWNLOAD_STATUS" && internal) {
    chrome.downloads
      .search({ id: message.id })
      .then((items) => respond({ state: items[0]?.state || "missing" }))
      .catch(() => respond({ state: "missing" }));
    return true;
  }
  if (message?.type === "KEEP_ALIVE" && internal) {
    respond({ ok: true });
    return;
  }
  if (message?.type !== "DOWNLOAD") return;
  const trusted =
    sender.id === chrome.runtime.id &&
    (sender.url === chrome.runtime.getURL("popup.html") ||
      (sender.tab && sender.frameId === 0 && isRedditPage(sender.url)));
  if (!trusted) {
    respond({ ok: false, error: "Download request rejected." });
    return;
  }
  const media = normalizeMedia(message.media);
  const variant = media?.variants.find((item) => item.url === message.url);
  if (!media || !variant) {
    respond({
      ok: false,
      error: "Only detected Reddit images and videos can be saved.",
    });
    return;
  }
  (async () => {
    let blobUrl;
    try {
      let url = variant.url;
      let downloadVariant = variant;
      if (media.kind === "video" && redgifsId(url)) {
        downloadVariant =
          await globalThis.__RD_DOWNLOADER_REDGIFS_V1__.resolve(url);
        url = downloadVariant.url;
      }
      if (media.kind === "video" && new URL(url).hostname === "v.redd.it") {
        await offscreen();
        const result = await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "PREPARE",
          media,
          url,
        });
        if (!result?.ok)
          throw new Error(
            result?.error || "Could not prepare the Reddit video.",
          );
        blobUrl = result.url;
        if (
          typeof blobUrl !== "string" ||
          !blobUrl.startsWith(`blob:${chrome.runtime.getURL("")}`)
        )
          throw new Error("Invalid prepared video.");
        url = blobUrl;
      }
      const id = await chrome.downloads.download({
        url,
        filename: filename(media, downloadVariant),
        conflictAction: "uniquify",
        saveAs: false,
      });
      if (blobUrl)
        await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "TRACK",
          url: blobUrl,
          id,
        });
      respond({ ok: true, id });
    } catch (error) {
      if (blobUrl)
        await chrome.runtime
          .sendMessage({ target: "offscreen", type: "RELEASE", url: blobUrl })
          .catch(() => {});
      respond({
        ok: false,
        error: error.message || "Chrome could not start the download.",
      });
    }
  })();
  return true;
});
