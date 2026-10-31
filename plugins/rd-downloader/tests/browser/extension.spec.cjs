const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createFile } = require("mp4box");
const {
  imageUrl,
  videoUrl,
  photo,
  video,
  manifest,
} = require("../fixtures.cjs");
let context,
  worker,
  id,
  page,
  responseData,
  playlist,
  failAudio,
  profile,
  downloads;
const image = fs.readFileSync(path.join(__dirname, "../assets/image.svg"));
function markup(kind = "image", post = "abc123") {
  const media =
    kind === "image"
      ? `<img src="${imageUrl()}" alt="Post photo" style="width:400px;height:300px;display:block">`
      : `<shreddit-player src="https://v.redd.it/clip1" style="display:block;width:400px;height:300px"></shreddit-player>`;
  return `<!doctype html><style>body{font:16px system-ui;margin:32px;background:#fafafa}shreddit-post{display:block;width:400px;border:1px solid #ccc;border-radius:12px;padding:16px} [data-media]{width:400px;height:300px}img{object-fit:cover}</style><main><shreddit-post post-id="t3_${post}" author="original_poster" content-href="${kind === "image" ? imageUrl() : "https://v.redd.it/clip1"}" post-title="A post"><a href="/r/test/comments/${post}/post/">u/original_poster</a><div data-media>${media}</div></shreddit-post><p data-next>Next post</p></main>`;
}
async function popup() {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  await panel.evaluate(() => scan());
  return panel;
}
async function loadFetch() {
  await page.evaluate(async () => (await fetch("/r/test/.json")).json());
}
async function prepareOffscreenFixture() {
  // Playwright cannot route hidden offscreen targets. Run the identical packaged
  // document in a routable extension tab; test native creation separately below.
  const document = await context.newPage();
  await document.goto(`chrome-extension://${id}/offscreen.html`);
  await worker.evaluate(() => {
    chrome.runtime.getContexts = async () => [
      { contextType: "OFFSCREEN_DOCUMENT" },
    ];
  });
  await page.bringToFront();
  return document;
}
async function clickInline() {
  await page.locator("[data-media]").hover();
  await page
    .locator("[data-rdd-controls]")
    .first()
    .click({ position: { x: 16, y: 16 } });
}
test.beforeEach(async () => {
  responseData = { data: { children: [{ kind: "t3", data: photo() }] } };
  playlist = manifest;
  failAudio = false;
  const extension = path.resolve("plugins/rd-downloader/extension");
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "reddit-extension-test-"));
  downloads = path.join(profile, "downloads");
  fs.mkdirSync(path.join(profile, "Default"));
  fs.writeFileSync(
    path.join(profile, "Default", "Preferences"),
    JSON.stringify({
      download: { default_directory: downloads, prompt_for_download: false },
    }),
  );
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    downloadsPath: downloads,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.downloadRequests = [];
    globalThis.realDownload = chrome.downloads.download.bind(chrome.downloads);
    chrome.downloads.download = async (options) => {
      const item = { ...options };
      downloadRequests.push(item);
      return 101;
    };
  });
  await context.route(/^https:\/\/(?:i|preview)\.redd\.it\//, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: image }),
  );
  await context.route("https://v.redd.it/**", (route) => {
    const url = route.request().url();
    if (url.includes(".mpd"))
      return route.fulfill({
        contentType: "application/dash+xml",
        body: playlist,
      });
    if (url.includes("AUDIO") && failAudio)
      return route.fulfill({ status: 403, body: "Expired" });
    return route.fulfill({
      contentType: "video/mp4",
      body: fs.readFileSync(
        path.join(
          __dirname,
          "../assets",
          url.includes("AUDIO") ? "audio.mp4" : "video.mp4",
        ),
      ),
    });
  });
  await context.route(/^https:\/\/(?:www|old)\.reddit\.com\//, (route) =>
    route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: markup() })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(responseData),
        }),
  );
  page = await context.newPage();
  await page.goto("https://www.reddit.com/r/test/");
});
test.afterEach(async () => {
  await context?.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});
test("Reddit DOM images get inline downloads without API calls or layout shifts", async () => {
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  const before = await page.locator("[data-next]").boundingBox();
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(imageUrl());
  expect(download.filename).toMatch(/^reddit\/@original_poster\/.*\.jpg$/);
  expect(download.saveAs).toBe(false);
  expect(await page.locator("[data-next]").boundingBox()).toEqual(before);
});
test("Reddit inline video combines real picture and audio tracks in a local MP4", async () => {
  await prepareOffscreenFixture();
  await worker.evaluate(() => {
    chrome.downloads.download = async (options) => {
      const id = await realDownload(options);
      downloadRequests.push({ ...options, id });
      return id;
    };
  });
  responseData = { data: { children: [{ kind: "t3", data: video() }] } };
  await page
    .locator("main")
    .evaluate(
      (main, html) => (main.outerHTML = html),
      markup("video", "def456"),
    );
  await loadFetch();
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.filename).toBe(
    "reddit/@original_poster/reddit_def456_def456_160x90.mp4",
  );
  await expect
    .poll(() =>
      worker.evaluate(
        async (id) => (await chrome.downloads.search({ id }))[0]?.state,
        download.id,
      ),
    )
    .toBe("complete");
  const saved = await worker.evaluate(
    async (id) => (await chrome.downloads.search({ id }))[0],
    download.id,
  );
  expect(fs.realpathSync(saved.filename)).toContain(
    fs.realpathSync(downloads) + path.sep,
  );
  const data = fs.readFileSync(saved.filename);
  const bytes = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.length,
  );
  bytes.fileStart = 0;
  const file = createFile();
  file.appendBuffer(bytes);
  file.flush();
  expect(file.getInfo().videoTracks).toHaveLength(1);
  expect(file.getInfo().audioTracks).toHaveLength(1);
});
test("Reddit popup reports audio failures and never silently downloads muted video", async () => {
  await prepareOffscreenFixture();
  responseData = { data: { children: [{ data: video() }] } };
  failAudio = true;
  await page
    .locator("main")
    .evaluate(
      (main, html) => (main.outerHTML = html),
      markup("video", "def456"),
    );
  await loadFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.getByRole("button", { name: "Save MP4" }).click();
  await expect(panel.locator("#status")).toContainText("403");
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(0);
});
test("Reddit galleries in open shadow roots have independent controls and stay current on navigation", async () => {
  await page.evaluate(
    ({ first, second }) => {
      const media = document.querySelector("[data-media]");
      media.replaceChildren();
      const gallery = document.createElement("gallery-carousel");
      media.append(gallery);
      gallery.attachShadow({ mode: "open" }).innerHTML =
        `<div style="display:flex"><div style="width:200px;height:300px"><img src="${first}" style="width:200px;height:300px"></div><div style="width:200px;height:300px"><img src="${second}" style="width:200px;height:300px"></div></div>`;
    },
    { first: imageUrl(), second: imageUrl("photo2") },
  );
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(2);
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    2,
  );
  await panel.close();
  await page.evaluate(() => {
    history.pushState({}, "", "/r/other/");
    document.querySelector("main").innerHTML = "<p>No media</p>";
  });
  const empty = await popup();
  await expect(empty.locator("#empty")).toBeVisible();
});
test("Old Reddit uses the post author and escaped API metadata; forged events cannot download", async () => {
  await page.goto("https://old.reddit.com/r/test/");
  await page.evaluate((url) => {
    document.querySelector("main").innerHTML =
      `<div class="thing" data-fullname="t3_abc123" data-author="old_author"><a class="comments" href="/r/test/comments/abc123/post/">Comments</a><div data-media style="width:400px;height:300px"><img src="${url}" style="width:400px;height:300px"></div></div>`;
  }, imageUrl());
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  expect((await worker.evaluate(() => downloadRequests))[0].filename).toContain(
    "reddit/@old_author/",
  );
  await loadFetch();
  const panel = await popup();
  await expect(panel.locator(".caption").first()).toContainText(
    "<script>unsafe()</script>",
  );
  expect(await panel.locator(".video script").count()).toBe(0);
  await panel
    .locator(".save")
    .first()
    .evaluate((button) => button.click());
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(1);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("rdd:media:v1", {
        detail: JSON.stringify([
          {
            postId: "abc123",
            mediaId: "evil",
            kind: "image",
            variants: [{ url: "https://evil.test/a.jpg" }],
          },
        ]),
      }),
    ),
  );
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(1);
});
test("Reddit screenshot captures the inline control and popup", async () => {
  responseData = {
    data: {
      children: [
        { data: { ...photo(), title: "A quiet afternoon in the mountains." } },
      ],
    },
  };
  await loadFetch();
  await page.locator("[data-media]").hover();
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  await page
    .locator("shreddit-post")
    .screenshot({ path: "plugins/rd-downloader/docs/inline.png" });
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel
    .locator("body")
    .screenshot({ path: "plugins/rd-downloader/docs/popup-light.png" });
  await panel.emulateMedia({ colorScheme: "dark" });
  await panel
    .locator("body")
    .screenshot({ path: "plugins/rd-downloader/docs/popup-dark.png" });
});

test("Reddit creates its packaged native offscreen document only once", async () => {
  await worker.evaluate(() => Promise.all([offscreen(), offscreen()]));
  const contexts = await worker.evaluate(() =>
    chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }),
  );
  expect(contexts).toHaveLength(1);
  expect(contexts[0].documentUrl).toBe(
    `chrome-extension://${id}/offscreen.html`,
  );
});

test("Reddit rejects unsafe audio playlists and does not mistake missing audio for silence", async () => {
  const document = await prepareOffscreenFixture();
  const errors = await document.evaluate(
    ({ manifest, address }) =>
      [
        manifest.replace("DASH_AUDIO_128.mp4", "https://evil.test/audio.mp4"),
        manifest.replace(
          "DASH_AUDIO_128.mp4",
          "https://v.redd.it/other/DASH_AUDIO_128.mp4",
        ),
        manifest.replace(
          "<BaseURL>DASH_AUDIO_128.mp4</BaseURL>",
          '<SegmentTemplate media="audio-$Number$.m4s"/>',
        ),
        manifest.replace('type="static"', 'type="dynamic"'),
        manifest.replace("<Period>", "<Period><ContentProtection/>"),
      ].map((text) => {
        try {
          parseManifest(text, address);
          return "";
        } catch (error) {
          return error.message;
        }
      }),
    { manifest, address: videoUrl("DASHPlaylist.mpd") },
  );
  expect(errors.every(Boolean)).toBe(true);
});

test("Reddit video placeholders save the video rather than its poster", async () => {
  await page.locator("shreddit-post").evaluate((post) => {
    post.setAttribute("content-href", "https://v.redd.it/clip1");
    post.setAttribute("post-type", "video");
  });
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    0,
  );
});

async function redgifsPost(
  destination = "https://www.redgifs.com/watch/CalmBlueOtter",
  iframe = "https://www.redgifs.com/ifr/CalmBlueOtter",
) {
  await page.evaluate(
    ({ destination, iframe }) => {
      const post = document.querySelector("shreddit-post");
      post.setAttribute("post-type", "link");
      post.setAttribute("content-href", destination);
      document.querySelector("[data-media]").innerHTML =
        `<iframe title="Embedded video" src="${iframe}" style="border:0;width:400px;height:300px"></iframe>`;
    },
    { destination, iframe },
  );
}
test("Redgifs iframe downloads resolve only on click and retain the Reddit author folder", async () => {
  const api = [];
  await context.route("https://www.redgifs.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><style>body{margin:0;display:grid;place-content:center;height:100vh;background:#182c30;color:#fff;font:16px system-ui}p{text-align:center}</style><p>&#9654;</p><p>Embedded video fixture</p>",
    }),
  );
  await context.route("https://api.redgifs.com/**", (route) => {
    api.push({
      url: route.request().url(),
      headers: route.request().headers(),
    });
    return route.fulfill({
      json: route.request().url().endsWith("/auth/temporary")
        ? { token: "fixture-token" }
        : {
            gif: {
              id: "calmblueotter",
              width: 1920,
              height: 1080,
              urls: {
                hd: "https://thumbs2.redgifs.com/CalmBlueOtter.mp4",
                sd: "https://thumbs2.redgifs.com/CalmBlueOtter-mobile.mp4",
              },
            },
          },
    });
  });
  await redgifsPost();
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(1);
  expect(api).toHaveLength(0);
  await panel.close();
  const before = await page.locator("[data-next]").boundingBox();
  await page
    .locator("shreddit-post")
    .screenshot({ path: "plugins/rd-downloader/docs/redgifs-inline.png" });
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [saved] = await worker.evaluate(() => downloadRequests);
  expect(saved.url).toBe("https://thumbs2.redgifs.com/CalmBlueOtter.mp4");
  expect(saved.filename).toBe(
    "reddit/@original_poster/reddit_abc123_abc123_1920x1080.mp4",
  );
  expect(api).toHaveLength(2);
  expect(api[1].headers.authorization).toBe("Bearer fixture-token");
  expect(await page.locator("[data-next]").boundingBox()).toEqual(before);
});
test("Redgifs API failures surface in the popup without downloading an HTML page or preview", async () => {
  await context.route("https://www.redgifs.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Fixture</p>" }),
  );
  await context.route("https://api.redgifs.com/**", (route) =>
    route.fulfill({ status: 403, json: { error: "Unavailable" } }),
  );
  await redgifsPost();
  const panel = await popup();
  await panel.getByRole("button", { name: "Save MP4" }).click();
  await expect(panel.locator("#status")).toContainText(
    "Redgifs request failed (403)",
  );
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(0);
});
test("Iframe-only Redgifs posts are detected and unrelated embeds stay unsupported", async () => {
  await context.route("https://www.redgifs.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Fixture</p>" }),
  );
  await context.route("https://example.org/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Unrelated embed</p>" }),
  );
  await redgifsPost("https://example.org/link");
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(1);
  await panel.close();
  await redgifsPost("https://example.org/link", "https://example.org/player");
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(0);
  const empty = await popup();
  await expect(empty.locator("#empty")).toBeVisible();
});
test("GIF MP4 sources in external link posts preserve the full signed URL and use MP4 filenames", async () => {
  const url =
    "https://external-preview.redd.it/animation.gif?format=mp4&s=signed";
  await context.route("https://external-preview.redd.it/**", (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: fs.readFileSync(path.join(__dirname, "../assets/video.mp4")),
    }),
  );
  await page.evaluate((url) => {
    const post = document.querySelector("shreddit-post");
    post.setAttribute("post-type", "link");
    post.setAttribute("content-href", "https://example.org/animation");
    document.querySelector("[data-media]").innerHTML =
      `<video controls loop muted style="width:400px;height:300px"><source type="video/mp4" src="${url}"></video>`;
  }, url);
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [saved] = await worker.evaluate(() => downloadRequests);
  expect(saved.url).toBe(url);
  expect(saved.filename).toMatch(/\.mp4$/);
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    0,
  );
});
test("GIF posts save the original animation when Reddit renders a still preview", async () => {
  await page
    .locator("shreddit-post")
    .evaluate((post) =>
      post.setAttribute("content-href", "https://i.redd.it/animation.gif"),
    );
  await expect(page.locator("[data-rdd-controls]")).toHaveCount(1);
  await clickInline();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [saved] = await worker.evaluate(() => downloadRequests);
  expect(saved.url).toBe("https://i.redd.it/animation.gif");
  expect(saved.filename).toMatch(/\.gif$/);
});
