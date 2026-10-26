const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");
const { tweet, mp4, photo } = require("../fixtures.cjs");

let context;
let worker;
let extensionId;
let page;
let responseData;

function postHtml(id = "123456789") {
  return `<article data-testid="tweet" style="width:520px"><a href="/example/status/${id}"><time>Oct 25</time></a><p>Example video</p><div data-testid="videoPlayer" style="width:480px;height:270px;background:#345;overflow:hidden"><video style="width:100%;height:100%"></video></div></article><p data-after>Next post</p>`;
}

test.beforeEach(async () => {
  responseData = { data: { result: tweet() } };
  const extension = path.resolve("plugins/tw-downloader/extension");
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
  extensionId = new URL(worker.url()).host;
  // Capture the Chrome download boundary; synthetic fixture URLs aren't real media.
  await worker.evaluate(() => {
    globalThis.downloadRequests = [];
    chrome.downloads.download = async (options) => {
      globalThis.downloadRequests.push(options);
      return 101;
    };
  });
  await context.route("https://x.com/**", async (route) => {
    if (route.request().url().includes("/i/api/")) {
      await route.fulfill({ json: responseData });
    } else {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>${postHtml()}</body></html>`,
      });
    }
  });
  page = await context.newPage();
  await page.goto("https://x.com/home");
});

test.afterEach(async () => {
  await context?.close();
});

async function loadViaFetch() {
  return page.evaluate(async () => {
    const response = await fetch("/i/api/graphql/fixture/HomeTimeline");
    return response.json();
  });
}

async function popup() {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.bringToFront();
  await popup.evaluate(() => scan());
  return popup;
}

test("observes real fetch responses, renders inline controls, and preserves X's response", async () => {
  const before = await page.locator("article").boundingBox();
  const nextBefore = await page.locator("[data-after]").boundingBox();
  expect(await loadViaFetch()).toEqual(responseData);
  const host = page.locator("[data-twd-controls]");
  await expect(host).toContainText(""); // Wait for an actual control host.
  await expect(host).toHaveCount(1);
  await expect
    .poll(() =>
      host.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(32);
  expect(await page.locator("article").boundingBox()).toEqual(before);
  expect(await page.locator("[data-after]").boundingBox()).toEqual(nextBefore);
  expect(
    await host.evaluate((element) => getComputedStyle(element).position),
  ).toBe("absolute");
  await page.locator('[data-testid="videoPlayer"]').hover();
  // A real mouse click reaches the closed shadow-root button, like a user click.
  await host.click({ position: { x: 16, y: 16 } });
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(mp4());
  expect(download.saveAs).toBe(false);
  expect(download.filename).toBe(
    "twitter/@example/twitter_example_123456789_700_1280x720.mp4",
  );
  expect(await page.locator("[data-after]").boundingBox()).toEqual(nextBefore);
  await page.screenshot({ path: "test-results/inline-overlay.png" });
});

test("popup shows safe text, selects quality, and sends a named MP4 download", async () => {
  await loadViaFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await expect(panel.locator(".video h3")).toHaveText("@example");
  await expect(panel.locator(".video .caption")).toContainText(
    "<script>alert('no')</script>",
  );
  expect(await panel.locator(".video script").count()).toBe(0);
  await panel.getByLabel("Quality for video 1").selectOption("1");
  await panel.getByRole("button", { name: "Save MP4" }).click();
  await expect(panel.locator("#status")).toContainText("Download started");
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(mp4("480x270"));
  expect(download.filename).toBe(
    "twitter/@example/twitter_example_123456789_700_480x270.mp4",
  );
  await panel.screenshot({ path: "test-results/popup-ready.png" });
});

test("keyboard users can focus the overlay and save without a mouse", async () => {
  await loadViaFetch();
  await expect(page.locator("[data-twd-controls]")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.hasAttribute("data-twd-controls"),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
});

test("video thumbnails can use a different ID from the video attachment", async () => {
  const poster =
    "https://pbs.twimg.com/amplify_video_thumb/999/img/thumbnail.jpg";
  responseData.data.result.legacy.extended_entities.media[0].media_url_https =
    poster;
  await page.locator("video").evaluate((video, src) => {
    video.poster = src;
  }, `${poster}?name=small`);
  await loadViaFetch();
  await expect(page.locator("[data-twd-controls]")).toHaveCount(1);
  await page.locator('[data-testid="videoPlayer"]').hover();
  await page
    .locator("[data-twd-controls]")
    .click({ position: { x: 16, y: 16 } });
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
});

test("observes XHR and replays metadata to a popup opened later", async () => {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/i/api/graphql/fixture/TweetDetail");
        xhr.responseType = "json";
        xhr.onload = () => resolve(xhr.response);
        xhr.send();
      }),
  );
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await expect(
    panel.getByLabel("Quality for video 1").locator("option"),
  ).toHaveCount(2);
});

test("a retweeted video downloads into the original poster's folder", async () => {
  const original = tweet();
  original.core.user_results.result.core.screen_name = "original_poster";
  const repost = tweet("987654321");
  repost.core.user_results.result.core.screen_name = "retweeter";
  repost.legacy.retweeted_status_result = { result: original };
  responseData = { data: { result: repost } };
  await loadViaFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await expect(panel.locator(".video h3")).toHaveText("@original_poster");
  await panel.getByRole("button", { name: "Save MP4" }).click();
  await expect(panel.locator("#status")).toContainText("Download started");
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.filename).toBe(
    "twitter/@original_poster/twitter_original_poster_123456789_700_1280x720.mp4",
  );
  expect(download.saveAs).toBe(false);
});

test("page messages cannot auto-download, and untrusted MP4 hosts are rejected", async () => {
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent("twd:media:v1", { detail: "invalid JSON" }),
    );
    document.dispatchEvent(
      new CustomEvent("twd:media:v1", {
        detail: JSON.stringify([
          {
            tweetId: "123456789",
            mediaId: "999",
            variants: [{ url: "https://video.twimg.com.evil.test/file.mp4" }],
          },
        ]),
      }),
    );
  });
  const panel = await popup();
  await expect(panel.locator("#empty")).toBeVisible();
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(0);
  await loadViaFetch();
  await page.bringToFront();
  await panel.evaluate(() => scan());
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.locator(".save").evaluate((button) => button.click());
  expect(await worker.evaluate(() => downloadRequests.length)).toBe(0);
});

test("updates recycled timeline articles and handles multiple videos", async () => {
  await loadViaFetch();
  await expect(page.locator("[data-twd-controls]")).toHaveCount(1);
  const next = tweet("987654321", "800");
  next.legacy.extended_entities.media.push({
    ...next.legacy.extended_entities.media[0],
    id_str: "801",
  });
  responseData = { data: { result: next } };
  await page.evaluate((html) => {
    document.querySelector("article").outerHTML = html;
  }, postHtml("987654321"));
  await loadViaFetch();
  const panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(2);
  await expect(page.locator("[data-twd-controls]")).toHaveCount(1);
  await expect(panel.locator(".post-link").first()).toHaveAttribute(
    "href",
    "https://x.com/i/status/987654321",
  );
});

test("handles HLS-only posts and clears catalog on full navigation", async () => {
  await loadViaFetch();
  let panel = await popup();
  await expect(panel.locator(".video")).toHaveCount(1);
  await panel.close();
  responseData.data.result.legacy.extended_entities.media[0].video_info.variants =
    [
      {
        content_type: "application/x-mpegURL",
        url: "https://video.twimg.com/live.m3u8",
      },
    ];
  await page.reload();
  await loadViaFetch();
  panel = await popup();
  await expect(panel.locator("#empty")).toBeVisible();
  await expect(panel.locator(".video")).toHaveCount(0);
  await panel.screenshot({ path: "test-results/popup-empty.png" });
});

test("photo albums get separate overlays with zero layout shift and original downloads", async () => {
  responseData.data.result.legacy.extended_entities.media = [
    photo(),
    photo("901", "secondPhoto", "png"),
  ];
  await context.route("https://pbs.twimg.com/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.evaluate(() => {
    document.querySelector('[data-testid="videoPlayer"]').outerHTML =
      `<div style="display:flex;gap:4px">${["fixturePhoto", "secondPhoto"].map((name, index) => `<a href="/example/status/123456789/photo/${index + 1}" style="display:block;width:238px"><div data-testid="tweetPhoto" style="height:200px;background:linear-gradient(135deg,#41796c,#dce9a4);overflow:hidden"><img alt="Photo ${index + 1}" style="width:100%;height:100%" src="https://pbs.twimg.com/media/${name}?format=${index ? "png" : "jpg"}&name=small"></div></a>`).join("")}</div>`;
  });
  const before = await page.locator("article").boundingBox();
  const nextBefore = await page.locator("[data-after]").boundingBox();
  let navigated = false;
  page.on("framenavigated", () => {
    navigated = true;
  });
  await loadViaFetch();
  await expect(page.locator("[data-twd-controls]")).toHaveCount(2);
  expect(await page.locator("article").boundingBox()).toEqual(before);
  expect(await page.locator("[data-after]").boundingBox()).toEqual(nextBefore);
  await page.locator('[data-testid="tweetPhoto"]').nth(1).hover();
  await page
    .locator("[data-twd-controls]")
    .nth(1)
    .click({ position: { x: 16, y: 16 } });
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(1);
  const [download] = await worker.evaluate(() => downloadRequests);
  expect(download.url).toBe(
    "https://pbs.twimg.com/media/secondPhoto?format=png&name=orig",
  );
  expect(download.filename).toBe(
    "twitter/@example/twitter_example_123456789_901_2048x1365.png",
  );
  expect(navigated).toBe(false);
  expect(await page.locator("[data-after]").boundingBox()).toEqual(nextBefore);
  await page.screenshot({ path: "test-results/images-overlay.png" });
  const panel = await popup();
  await expect(panel.getByRole("button", { name: "Save image" })).toHaveCount(
    2,
  );
  await panel.getByRole("button", { name: "Save image" }).first().click();
  await expect
    .poll(() => worker.evaluate(() => downloadRequests.length))
    .toBe(2);
  const downloads = await worker.evaluate(() => downloadRequests);
  expect(downloads[1].url).toBe(
    "https://pbs.twimg.com/media/fixturePhoto?format=jpg&name=orig",
  );
});
