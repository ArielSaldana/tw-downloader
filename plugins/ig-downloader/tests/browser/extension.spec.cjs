const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");
const {
  imageUrl,
  videoUrl,
  photo,
  video,
  carousel,
} = require("../fixtures.cjs");
let context, worker, id, page, responseData, responseMode;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
  "base64",
);
function markup(code = "FixtureReel", kind = "video") {
  const body =
    kind === "video"
      ? `<video poster="${imageUrl("poster")}" style="width:100%;height:100%"></video>`
      : `<img alt="Post photo" src="${imageUrl()}" style="width:100%;height:100%">`;
  return `<!doctype html><main><article style="width:400px"><a href="/p/${code}/"><time>Today</time></a><div data-media style="width:400px;height:400px;overflow:hidden">${body}</div></article><p data-next>Next post</p></main>`;
}

test.beforeEach(async () => {
  responseData = { items: [video()] };
  responseMode = "json";
  const extension = path.resolve("plugins/ig-downloader/extension");
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
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
    chrome.downloads.download = async (options) => {
      downloadRequests.push(options);
      return 101;
    };
  });
  await context.route(
    /https:\/\/[^/]+\.(?:cdninstagram\.com|fbcdn\.net)\//,
    (route) => route.fulfill({ contentType: "image/png", body: png }),
  );
  await context.route("https://www.instagram.com/**", (route) => {
    if (route.request().resourceType() === "document")
      return route.fulfill({ contentType: "text/html", body: markup() });
    const body =
      responseMode === "stream"
        ? responseData.map((item) => JSON.stringify(item)).join("\n")
        : JSON.stringify(responseData);
    return route.fulfill({
      contentType:
        responseMode === "json" ? "application/json" : "text/javascript",
      body: responseMode === "prefixed" ? `for (;;);${body}` : body,
    });
  });
  page = await context.newPage();
  await page.goto("https://www.instagram.com/");
});
test.afterEach(async () => {
  await context?.close();
});
async function loadFetch() {
  return page.evaluate(async () => (await fetch("/graphql/query/")).text());
}
async function popup() {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  await panel.evaluate(() => scan());
  return panel;
}

test("Instagram Reel overlays add no layout shift and save complete highest-quality MP4 URLs", async () => {
  const before = await page.locator("article").boundingBox(),
    next = await page.locator("[data-next]").boundingBox();
  expect(JSON.parse(await loadFetch())).toEqual(responseData);
  await expect(page.locator("[data-igd-controls]")).toHaveCount(1);
  expect(await page.locator("article").boundingBox()).toEqual(before);
  expect(await page.locator("[data-next]").boundingBox()).toEqual(next);
  await page.locator("[data-media]").hover();
  await page
    .locator("[data-igd-controls]")
    .click({ position: { x: 16, y: 16 } });
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(videoUrl());
  expect(download.saveAs).toBe(false);
  expect(download.filename).toBe(
    "instagram/@original.poster/instagram_original.poster_FixtureReel_700_1080x1920.mp4",
  );
  expect(await page.locator("[data-next]").boundingBox()).toEqual(next);
});

test("Instagram popup exposes video quality and escapes captions", async () => {
  await loadFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await expect(panel.locator(".video h3")).toHaveText("@original.poster");
  await expect(panel.locator(".caption")).toContainText(
    "<script>unsafe()</script>",
  );
  expect(await panel.locator(".video script").count()).toBe(0);
  await panel.getByLabel("Quality for video 1").selectOption("1");
  await panel.getByRole("button", { name: "Save MP4" }).click();
  await expect(panel.locator("#status")).toContainText("Download started");
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(videoUrl("small"));
  await expect(panel.locator(".destination")).toContainText(
    "instagram/@original.poster/",
  );
});

test("Instagram mixed carousels have separate image and video controls with the album owner", async () => {
  responseData = { items: [carousel()] };
  await page.evaluate(
    ({ image, poster }) => {
      document.querySelector("a").href = "/p/FixtureAlbum/";
      document.querySelector("[data-media]").outerHTML =
        `<div style="display:flex"><div data-photo style="width:200px;height:300px"><img alt="Carousel photo" src="${image}" style="width:100%;height:100%"></div><div data-video style="width:200px;height:300px"><video poster="${poster}" style="width:100%;height:100%"></video></div></div>`;
    },
    { image: imageUrl(), poster: imageUrl("poster") },
  );
  const before = await page.locator("[data-next]").boundingBox();
  await loadFetch();
  await expect(page.locator("[data-igd-controls]")).toHaveCount(2);
  expect(await page.locator("[data-next]").boundingBox()).toEqual(before);
  await page.locator("[data-photo]").hover();
  await page
    .locator("[data-photo] [data-igd-controls]")
    .click({ position: { x: 16, y: 16 } });
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.filename).toBe(
    "instagram/@album.owner/instagram_album.owner_FixtureAlbum_900_1080x1350.jpg",
  );
  expect(download.url).toBe(imageUrl());
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    1,
  );
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(1);
});

test("Instagram parses anti-JSON prefixes and newline-delimited GraphQL responses", async () => {
  responseMode = "prefixed";
  await loadFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.close();
  responseMode = "stream";
  responseData = [{ items: [video()] }, { items: [photo()] }];
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/p/FixturePost/";
    link.textContent = "Photo post";
    document.querySelector("article").append(link);
  });
  await loadFetch();
  const updated = await popup();
  await expect(updated.locator(".video")).toHaveCount(2);
});

test("Instagram XHR and late Relay hydration scripts populate the catalog without extra API requests", async () => {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/v1/feed/timeline/");
        xhr.responseType = "json";
        xhr.onload = resolve;
        xhr.send();
      }),
  );
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.close();
  await page.evaluate((item) => {
    const link = document.createElement("a");
    link.href = "/p/FixturePost/";
    document.querySelector("article").append(link);
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify({
      require: [["ScheduledServerJS", { __bbox: { data: { item } } }]],
    });
    document.body.append(script);
  }, photo());
  const hydrated = await popup();
  await expect(hydrated.locator(".video")).toHaveCount(2);
});

test("Instagram updates recycled post media and clears old catalog entries on navigation", async () => {
  await loadFetch();
  await expect(page.locator("[data-igd-controls]")).toHaveCount(1);
  responseData = { items: [photo()] };
  await page.evaluate((image) => {
    document.querySelector("a").href = "/p/FixturePost/";
    document.querySelector("video").outerHTML =
      `<img alt="New image" src="${image}" style="width:100%;height:100%">`;
  }, imageUrl());
  await loadFetch();
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    1,
  );
  await expect(panel.getByRole("button", { name: "Save MP4" })).toHaveCount(0);
  await panel.close();
  responseData = { items: [] };
  await page.reload();
  const empty = await popup();
  await expect(empty.locator("#empty")).toBeVisible();
});

test("Instagram forgeable page events and synthetic clicks cannot trigger downloads", async () => {
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("igd:media:v1", {
        detail: JSON.stringify([
          {
            postId: "1",
            mediaId: "2",
            code: "abc",
            author: "bad",
            kind: "video",
            variants: [{ url: "https://cdninstagram.com.evil.test/file.mp4" }],
          },
        ]),
      }),
    ),
  );
  const empty = await popup();
  await expect(empty.locator("#empty")).toBeVisible();
  await empty.close();
  await loadFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.locator(".save").evaluate((button) => button.click());
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(0);
});
