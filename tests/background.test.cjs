const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { mp4 } = require("./fixtures.cjs");

function setup(failure) {
  let listener;
  const downloads = [];
  const context = vm.createContext({
    URL,
    chrome: {
      runtime: {
        id: "test-id",
        getURL: (file) => `chrome-extension://test-id/${file}`,
        onMessage: {
          addListener: (fn) => {
            listener = fn;
          },
        },
      },
      downloads: {
        download: async (options) => {
          if (failure) throw new Error(failure);
          downloads.push(options);
          return 42;
        },
      },
    },
    importScripts: () =>
      vm.runInContext(readFileSync("extension/media.js", "utf8"), context),
  });
  vm.runInContext(readFileSync("extension/background.js", "utf8"), context);
  return {
    downloads,
    send: (message, sender) =>
      new Promise((resolve) => listener(message, sender, resolve)),
  };
}

const video = {
  tweetId: "123",
  mediaId: "456",
  author: "example",
  variants: [{ url: mp4() }],
};
const request = { type: "DOWNLOAD", media: video, url: mp4() };
const popup = { id: "test-id", url: "chrome-extension://test-id/popup.html" };

test("saves MP4s directly into the author's folder without a save dialog", async () => {
  const worker = setup();
  assert.equal((await worker.send(request, popup)).ok, true);
  assert.equal(worker.downloads.length, 1);
  assert.equal(worker.downloads[0].saveAs, false);
  assert.equal(worker.downloads[0].conflictAction, "uniquify");
  assert.equal(
    worker.downloads[0].filename,
    "twitter/@example/twitter_example_123_456_1280x720.mp4",
  );
});

test("accepts top-frame X content controls", async () => {
  const worker = setup();
  const result = await worker.send(request, {
    id: "test-id",
    tab: { id: 1 },
    frameId: 0,
    url: "https://x.com/home",
  });
  assert.equal(result.ok, true);
});

test("rejects other senders, frames, pages, and arbitrary files", async () => {
  const worker = setup();
  for (const sender of [
    { ...popup, id: "other-extension" },
    { ...popup, url: "https://evil.test" },
    { ...popup, tab: { id: 1 }, frameId: 2, url: "https://x.com/home" },
    { ...popup, tab: { id: 1 }, frameId: 0, url: "https://x.com.evil.test" },
  ])
    assert.equal((await worker.send(request, sender)).ok, false);
  assert.equal(
    (
      await worker.send(
        { ...request, url: "https://evil.test/clip.mp4" },
        popup,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await worker.send(
        { ...request, media: { ...video, tweetId: "../../file" } },
        popup,
      )
    ).ok,
    false,
  );
  assert.equal(worker.downloads.length, 0);
});

test("returns Chrome errors instead of reporting success", async () => {
  const worker = setup("User canceled the download.");
  const result = await worker.send(request, popup);
  assert.equal(result.ok, false);
  assert.equal(result.error, "User canceled the download.");
});

test("saves an original image with its actual extension and author directory", async () => {
  const worker = setup();
  const url = "https://pbs.twimg.com/media/photo?format=png&name=orig";
  const image = {
    tweetId: "123",
    mediaId: "900",
    author: "photographer",
    kind: "image",
    variants: [{ url, width: 2048, height: 1365 }],
  };
  assert.equal(
    (await worker.send({ type: "DOWNLOAD", media: image, url }, popup)).ok,
    true,
  );
  assert.equal(worker.downloads[0].url, url);
  assert.equal(
    worker.downloads[0].filename,
    "twitter/@photographer/twitter_photographer_123_900_2048x1365.png",
  );
  assert.equal(worker.downloads[0].saveAs, false);
  const bad = {
    ...image,
    variants: [{ url: "https://pbs.twimg.com/media/photo?format=svg" }],
  };
  assert.equal(
    (
      await worker.send(
        { type: "DOWNLOAD", media: bad, url: bad.variants[0].url },
        popup,
      )
    ).ok,
    false,
  );
  assert.equal(worker.downloads.length, 1);
});
