/* Runs only in the extension's offscreen document, never in Reddit's page. */
const { normalizeMedia, videoBase, trackUrl, manifestUrl } =
  globalThis.__RD_DOWNLOADER_MEDIA_V1__;
const blobs = new Map();
let busy = false;
async function fetchBytes(url, limit) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok)
    throw new Error(
      `Reddit media request failed (${response.status}). Refresh the post and try again.`,
    );
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error(
      "This video is too large to combine locally (128 MB per track).",
    );
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error(
          "This video is too large to combine locally (128 MB per track).",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
function parseManifest(text, address) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (
    xml.querySelector("parsererror") ||
    xml.documentElement.localName !== "MPD" ||
    xml.documentElement.getAttribute("type") === "dynamic" ||
    xml.querySelector("ContentProtection") ||
    xml.querySelectorAll("Period").length !== 1
  )
    throw new Error("This Reddit video playlist is not supported.");
  const base = videoBase(address),
    tracks = [];
  for (const rep of xml.querySelectorAll("Representation")) {
    if (
      rep.querySelector("SegmentTemplate, SegmentList") ||
      rep.parentElement.querySelector(
        ":scope > SegmentTemplate, :scope > SegmentList",
      )
    )
      continue;
    let url = address;
    const ancestors = [];
    for (let node = rep; node && node.nodeType === 1; node = node.parentElement)
      ancestors.unshift(node);
    for (const node of ancestors) {
      const part = [...node.children].find(
        (child) => child.localName === "BaseURL",
      );
      if (part) url = new URL(part.textContent.trim(), url).href;
    }
    if (!trackUrl(url, base) || !/\.mp4(?:\?|$)/i.test(url)) continue;
    const parent = rep.parentElement;
    const type =
      rep.getAttribute("mimeType") ||
      parent.getAttribute("mimeType") ||
      rep.getAttribute("contentType") ||
      parent.getAttribute("contentType") ||
      "";
    tracks.push({
      url,
      kind: type.startsWith("audio")
        ? "audio"
        : type.startsWith("video")
          ? "video"
          : "",
      width: Number(rep.getAttribute("width")),
      height: Number(rep.getAttribute("height")),
      bandwidth: Number(rep.getAttribute("bandwidth")),
    });
  }
  const expectsAudio = [
    ...xml.querySelectorAll("AdaptationSet, Representation"),
  ].some((node) =>
    /audio/.test(
      `${node.getAttribute("mimeType")} ${node.getAttribute("contentType")}`,
    ),
  );
  if (expectsAudio && !tracks.some((item) => item.kind === "audio"))
    throw new Error("Could not locate a complete Reddit audio track.");
  return tracks;
}
async function prepare(media, chosen) {
  const limit = 128 * 1024 * 1024;
  let video;
  if (/\.mp4(?:\?|$)/i.test(chosen.url)) {
    video = await fetchBytes(chosen.url, limit);
    if (media.isGif || RedditMux.hasAudio(video)) return video;
  }
  const manifest = manifestUrl(chosen.url);
  const tracks = parseManifest(
    new TextDecoder().decode(await fetchBytes(manifest, 1024 * 1024)),
    manifest,
  );
  const videos = tracks
    .filter((item) => item.kind === "video")
    .sort(
      (a, b) =>
        b.width * b.height - a.width * a.height || b.bandwidth - a.bandwidth,
    );
  const selected =
    videos.find(
      (item) => new URL(item.url).pathname === new URL(chosen.url).pathname,
    ) || videos[0];
  if (!video) {
    if (!selected)
      throw new Error("No complete MP4 was found in this Reddit playlist.");
    video = await fetchBytes(selected.url, limit);
  }
  const audio = tracks
    .filter((item) => item.kind === "audio")
    .sort((a, b) => b.bandwidth - a.bandwidth)[0];
  // A valid playlist with no audio describes a genuinely silent clip.
  if (!audio) {
    if (!videos.length || xmlHasAudioProblem(tracks))
      throw new Error("Could not locate the Reddit audio track.");
    return video;
  }
  return RedditMux.mux(video, await fetchBytes(audio.url, limit));
}
function xmlHasAudioProblem(tracks) {
  return tracks.some((item) => !item.kind);
}
function release(url) {
  const item = blobs.get(url);
  if (!item) return;
  clearTimeout(item.timer);
  URL.revokeObjectURL(url);
  blobs.delete(url);
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js") ||
    sender.tab ||
    message?.target !== "offscreen"
  )
    return;
  if (message.type === "RELEASE") {
    release(message.url);
    respond({ ok: true });
    return;
  }
  if (message.type === "TRACK") {
    const item = blobs.get(message.url);
    if (item && Number.isInteger(message.id)) {
      clearTimeout(item.timer);
      item.id = message.id;
    }
    respond({ ok: Boolean(item) });
    return;
  }
  if (message.type !== "PREPARE") return;
  const media = normalizeMedia(message.media),
    chosen = media?.variants.find((item) => item.url === message.url);
  if (!chosen || !videoBase(chosen.url) || media.kind !== "video" || busy) {
    respond({
      ok: false,
      error: busy
        ? "Another video is being prepared. Try again shortly."
        : "Invalid Reddit video.",
    });
    return;
  }
  busy = true;
  prepare(media, chosen)
    .then((buffer) => {
      const url = URL.createObjectURL(
        new Blob([buffer], { type: "video/mp4" }),
      );
      blobs.set(url, { timer: setTimeout(() => release(url), 60000) });
      respond({ ok: true, url });
    })
    .catch((error) => respond({ ok: false, error: error.message }))
    .finally(() => {
      busy = false;
    });
  return true;
});
setInterval(async () => {
  if (busy)
    await chrome.runtime.sendMessage({ type: "KEEP_ALIVE" }).catch(() => {});
  for (const [url, item] of blobs)
    if (item.id !== undefined) {
      try {
        const status = await chrome.runtime.sendMessage({
          type: "DOWNLOAD_STATUS",
          id: item.id,
        });
        if (status?.state && status.state !== "in_progress") release(url);
      } catch {
        /* Retry after worker restart. */
      }
    }
}, 15000);
