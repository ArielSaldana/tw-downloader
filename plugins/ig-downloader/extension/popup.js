const site = globalThis.__MEDIA_SAVER_SITE__;
const { normalizeMedia } = site;
document.title = site.title;
document.querySelector("h1").textContent = site.title.replace(
  " Media Saver",
  " Saver",
);
document.querySelector(".eyebrow").textContent =
  site.id === "ig-downloader"
    ? "VIDEOS & FULL-SIZE IMAGES"
    : "VIDEOS & ORIGINAL IMAGES";
document.documentElement.dataset.plugin = site.id;
document.querySelector("#empty-help").textContent =
  `Open a post on ${site.label}, then scan again. Just installed or updated? Refresh that tab once to connect.`;
const list = document.querySelector("#videos");
const status = document.querySelector("#status");
const empty = document.querySelector("#empty");
const refresh = document.querySelector("#refresh");
document.querySelector("#version").textContent =
  `v${chrome.runtime.getManifest().version}`;

function setStatus(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
}

function renderMedia(media, index) {
  const card = document.createElement("section");
  card.className = "video";
  const title = document.createElement("h3");
  title.textContent = media.author ? `@${media.author}` : `Media ${index + 1}`;
  const heading = document.createElement("div");
  heading.className = "card-heading";
  const type = document.createElement("span");
  type.className = "media-type";
  type.textContent = media.kind === "image" ? "Image" : "Video";
  heading.append(title, type);
  const text = document.createElement("p");
  text.className = "caption";
  text.textContent = media.text || `Post ${site.postId(media)}`;
  const row = document.createElement("div");
  row.className = "row";
  const select = document.createElement("select");
  select.setAttribute(
    "aria-label",
    `Quality for ${media.kind === "image" ? "image" : "video"} ${index + 1}`,
  );
  media.variants.forEach((variant, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    const dimensions = variant.width
      ? `${variant.width} × ${variant.height}`
      : "MP4";
    option.textContent =
      media.kind === "image"
        ? `Original image${variant.width ? ` · ${dimensions}` : ""}`
        : `${dimensions}${index === 0 ? " · Best" : ""}`;
    select.append(option);
  });
  const save = document.createElement("button");
  save.className = "save";
  save.type = "button";
  save.textContent = media.kind === "image" ? "↓ Save image" : "↓ Save MP4";
  save.addEventListener("click", async (event) => {
    if (!event.isTrusted || save.disabled) return;
    save.disabled = true;
    setStatus("Starting download…");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD",
        media,
        url: media.variants[Number(select.value)].url,
      });
      if (!response?.ok)
        throw new Error(
          response?.error || "Chrome could not start the download.",
        );
      setStatus("Download started. Check Chrome’s downloads for progress.");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      save.disabled = false;
    }
  });
  if (media.kind === "image") {
    const info = document.createElement("span");
    info.className = "image-info";
    const variant = media.variants[0];
    const format = site.imageFormat(variant);
    info.textContent = `${variant.width ? `${variant.width} × ${variant.height}` : site.imageLabel} · ${format}`;
    info.title = site.imageLabel;
    row.append(info, save);
  } else {
    row.append(select, save);
  }
  const destination = document.createElement("p");
  destination.className = "destination";
  destination.textContent = `Saves to ${site.folder}/@${media.author || "unknown"}/`;
  const link = document.createElement("a");
  link.className = "post-link";
  link.href = site.postUrl(media);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View post ↗";
  const footer = document.createElement("div");
  footer.className = "card-footer";
  footer.append(destination, link);
  card.append(heading, text, row, footer);
  list.append(card);
}

async function scan() {
  refresh.disabled = true;
  refresh.textContent = "Scanning…";
  list.setAttribute("aria-busy", "true");
  list.replaceChildren();
  empty.hidden = true;
  setStatus("Looking for media…");
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error(`Open a ${site.label} tab to find media.`);
    const response = await chrome.tabs.sendMessage(
      tab.id,
      { type: "LIST_MEDIA" },
      { frameId: 0 },
    );
    if (!response?.ok || !Array.isArray(response.media))
      throw new Error(`Refresh your ${site.label} tab once, then scan again.`);
    const media = response.media
      .slice(0, 150)
      .map(normalizeMedia)
      .filter(Boolean);
    empty.hidden = media.length > 0;
    setStatus(
      media.length
        ? `${media.length} item${media.length === 1 ? "" : "s"} ready to save.`
        : "No videos or images detected on this page yet.",
    );
    media.forEach(renderMedia);
  } catch {
    empty.hidden = false;
    setStatus(`Open ${site.label} and refresh the tab once, then scan again.`);
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Scan again";
    list.setAttribute("aria-busy", "false");
  }
}

refresh.addEventListener("click", scan);
scan();
