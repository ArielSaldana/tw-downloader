const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../extension/media.js");
const m = globalThis.__RD_DOWNLOADER_MEDIA_V1__;
const { photo, video, gallery, imageUrl, videoUrl } = require("./fixtures.cjs");
test("Reddit images use originals and the post author folder", () => {
  const [item] = m.extractMedia({
    data: { children: [{ kind: "t3", data: photo() }] },
  });
  assert.equal(item.variants[0].url, imageUrl());
  assert.equal(
    m.filename(item, item.variants[0]),
    "reddit/@original_poster/reddit_abc123_photo1_1200x800.jpg",
  );
});
test("Reddit videos and ordered mixed galleries retain media types and dimensions", () => {
  const [item] = m.extractMedia(video());
  assert.equal(item.kind, "video");
  assert.equal(item.variants[0].url, videoUrl());
  const items = m.extractMedia(gallery());
  assert.deepEqual(
    items.map((item) => item.kind),
    ["image", "video"],
  );
  assert.equal(items[1].isGif, true);
  assert.equal(items[0].variants[0].url, imageUrl());
});
test("Crossposts retain the original author with the displayed post identity", () => {
  const cross = {
    ...photo(),
    name: "t3_bbb222",
    author: "reposter",
    crosspost_parent_list: [video()],
  };
  const items = m.extractMedia(cross);
  assert.equal(items.length, 1);
  assert.equal(items[0].postId, "bbb222");
  assert.equal(items[0].author, "original_poster");
});
test("Reddit rejects unsafe hosts, URLs, ids and traversal; deleted authors use unknown", () => {
  for (const url of [
    "http://i.redd.it/a.jpg",
    "https://i.redd.it.evil.test/a.jpg",
    "https://evil.test/a.jpg",
    "https://i.redd.it:444/a.jpg",
    "https://user@i.redd.it/a.jpg",
    "data:image/png,test",
    "https://i.redd.it/a.jpg#hash",
  ])
    assert.equal(m.imageUrl(url), null, url);
  for (const url of [
    "https://v.redd.it.evil.test/a/DASH_720.mp4",
    "https://v.redd.it/clip1/DASH_AUDIO_128.mp4",
    "https://v.redd.it/clip1/HLSPlaylist.m3u8",
  ])
    assert.equal(m.videoUrl(url), null, url);
  const [media] = m.extractMedia(photo());
  assert.equal(m.normalizeMedia({ ...media, postId: "../../bad" }), null);
  const unknown = m.normalizeMedia({ ...media, author: "[deleted]" });
  assert.match(m.filename(unknown, unknown.variants[0]), /^reddit\/@unknown\//);
  assert.equal(m.postId("https://evil.test/comments/abc123/"), "");
  assert.equal(
    m.trackUrl(
      "https://v.redd.it/other/DASH_AUDIO_128.mp4",
      m.videoBase(videoUrl()),
    ),
    null,
  );
});
test("Reddit ignores unsupported external embeds, comments, broken gallery entries and cycles", () => {
  assert.deepEqual(
    m.extractMedia({
      ...photo(),
      url_overridden_by_dest: "https://youtube.com/watch?v=1",
    }),
    [],
  );
  assert.deepEqual(m.extractMedia({ ...photo(), body: "comment" }), []);
  const album = gallery();
  album.media_metadata.photo1.status = "failed";
  album.loop = album;
  assert.equal(m.extractMedia(album).length, 1);
});
test("Reddit normalizes signed escaped links and removes duplicate variants", () => {
  const [item] = m.extractMedia(video());
  const normalized = m.normalizeMedia({
    ...item,
    variants: [
      ...item.variants,
      ...item.variants,
      {
        url: videoUrl("DASH_1080.mp4") + "?a=one&amp;b=two",
        width: 1920,
        height: 1080,
      },
    ],
  });
  assert.equal(normalized.variants.length, 2);
  assert.match(normalized.variants[0].url, /a=one&b=two$/);
});

test("Reddit titled previews map back to their original image identity", () => {
  const preview =
    "https://preview.redd.it/a-mountain-v0-photo123.jpg?width=640&auto=webp&s=signed";
  assert.equal(m.originalImage(preview), "https://i.redd.it/photo123.jpg");
  assert.equal(
    m.assetKey(preview),
    m.assetKey("https://i.redd.it/photo123.jpg"),
  );
});

test("Reddit ignores malformed optional preview and gallery fields", () => {
  assert.equal(
    m.extractMedia({ ...photo(), preview: { images: { bad: true } } }).length,
    1,
  );
  const album = gallery();
  album.gallery_data.items.unshift(null);
  album.media_metadata.photo1.p = { bad: true };
  assert.equal(m.extractMedia(album).length, 2);
});
