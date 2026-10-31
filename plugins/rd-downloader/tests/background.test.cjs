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
    importScripts: (...files) =>
      files.forEach((file) =>
        vm.runInContext(
          readFileSync(`plugins/rd-downloader/extension/${file}`, "utf8"),
          context,
        ),
      ),
  });
  vm.runInContext(
    readFileSync("plugins/rd-downloader/extension/background.js", "utf8"),
    context,
  );
  return {
    downloads,
    send: (message, sender) =>
      new Promise((resolve) => listener(message, sender, resolve)),
  };
}

const { photo: fixture } = require("./fixtures.cjs");
const isolated = vm.createContext({ URL });
vm.runInContext(
  readFileSync("plugins/rd-downloader/extension/media.js", "utf8"),
  isolated,
);
const media = isolated.__RD_DOWNLOADER_MEDIA_V1__.extractMedia(fixture())[0];
const request = { type: "DOWNLOAD", media, url: media.variants[0].url };
const popup = { id: "test-id", url: "chrome-extension://test-id/popup.html" };

test("Reddit accepts popup and top-frame downloads into the original author's folder", async () => {
  const worker = setup();
  assert.equal((await worker.send(request, popup)).ok, true);
  assert.equal(
    (
      await worker.send(request, {
        id: "test-id",
        tab: { id: 1 },
        frameId: 0,
        url: "https://www.reddit.com/comments/abc123/",
      })
    ).ok,
    true,
  );
  assert.equal(
    worker.downloads[0].filename,
    "reddit/@original_poster/reddit_abc123_photo1_1200x800.jpg",
  );
  assert.equal(worker.downloads[0].saveAs, false);
  assert.equal(worker.downloads[0].conflictAction, "uniquify");
});
test("Reddit rejects other pages, extensions, frames and download URL substitution", async () => {
  const worker = setup();
  for (const sender of [
    { ...popup, id: "other-extension" },
    { ...popup, url: "https://www.reddit.com/" },
    {
      id: "test-id",
      tab: { id: 1 },
      frameId: 2,
      url: "https://www.reddit.com/",
    },
    {
      id: "test-id",
      tab: { id: 1 },
      frameId: 0,
      url: "https://www.reddit.com.evil.test/",
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
test("Reddit reports Chrome download failures", async () => {
  const worker = setup("Download could not start.");
  assert.equal(
    (await worker.send(request, popup)).error,
    "Download could not start.",
  );
});
