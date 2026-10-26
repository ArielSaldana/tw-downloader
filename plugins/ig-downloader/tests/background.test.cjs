const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

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
      vm.runInContext(
        readFileSync("plugins/ig-downloader/extension/media.js", "utf8"),
        context,
      ),
  });
  vm.runInContext(
    readFileSync("plugins/ig-downloader/extension/background.js", "utf8"),
    context,
  );
  return {
    downloads,
    send: (message, sender) =>
      new Promise((resolve) => listener(message, sender, resolve)),
  };
}

const { video: fixture } = require("./fixtures.cjs");
const isolated = vm.createContext({ URL });
vm.runInContext(
  readFileSync("plugins/ig-downloader/extension/media.js", "utf8"),
  isolated,
);
const media = isolated.__IG_DOWNLOADER_MEDIA_V1__.extractMedia(fixture())[0];
const request = { type: "DOWNLOAD", media, url: media.variants[0].url };
const popup = { id: "test-id", url: "chrome-extension://test-id/popup.html" };

test("Instagram accepts popup and top-frame downloads into the original author's folder", async () => {
  const worker = setup();
  assert.equal((await worker.send(request, popup)).ok, true);
  assert.equal(
    (
      await worker.send(request, {
        id: "test-id",
        tab: { id: 1 },
        frameId: 0,
        url: "https://www.instagram.com/p/FixtureReel/",
      })
    ).ok,
    true,
  );
  assert.equal(
    worker.downloads[0].filename,
    "instagram/@original.poster/instagram_original.poster_FixtureReel_700_1080x1920.mp4",
  );
  assert.equal(worker.downloads[0].saveAs, false);
  assert.equal(worker.downloads[0].conflictAction, "uniquify");
});
test("Instagram rejects other pages, extensions, frames and download URL substitution", async () => {
  const worker = setup();
  for (const sender of [
    { ...popup, id: "other-extension" },
    { ...popup, url: "https://www.instagram.com/" },
    {
      id: "test-id",
      tab: { id: 1 },
      frameId: 2,
      url: "https://www.instagram.com/",
    },
    {
      id: "test-id",
      tab: { id: 1 },
      frameId: 0,
      url: "https://www.instagram.com.evil.test/",
    },
  ])
    assert.equal((await worker.send(request, sender)).ok, false);
  assert.equal(
    (await worker.send({ ...request, url: "https://evil.test/a.mp4" }, popup))
      .ok,
    false,
  );
  assert.equal(worker.downloads.length, 0);
});
test("Instagram reports Chrome download failures", async () => {
  const worker = setup("Download could not start.");
  assert.equal(
    (await worker.send(request, popup)).error,
    "Download could not start.",
  );
});
