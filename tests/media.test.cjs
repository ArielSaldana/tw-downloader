const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { mp4, tweet, photo } = require("./fixtures.cjs");

const context = vm.createContext({ URL });
vm.runInContext(readFileSync("extension/media.js", "utf8"), context);
const media = context.__TW_DOWNLOADER_MEDIA_V1__;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("extracts GraphQL videos with metadata and highest quality first", () => {
  const [result] = media.extractMedia({
    data: { instructions: [{ result: tweet() }] },
  });
  assert.equal(result.tweetId, "123456789");
  assert.equal(result.author, "example");
  assert.match(result.text, /sample video/);
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0].width, 1280);
});

test("retweets, quoted tweets, and multi-video posts retain their own IDs", () => {
  const outer = tweet();
  outer.quoted_status_result = { result: tweet("987654321", "800") };
  outer.legacy.extended_entities.media.push({
    ...outer.legacy.extended_entities.media[0],
    id_str: "701",
  });
  const result = media.extractMedia({
    retweeted_status_result: { result: outer },
  });
  assert.deepEqual(
    plain(result.map((item) => `${item.tweetId}:${item.mediaId}`).sort()),
    ["123456789:700", "123456789:701", "987654321:800"],
  );
});

test("retweets with copied media use the original author and post only", () => {
  for (const location of ["node", "legacy"]) {
    const original = tweet("111", "700");
    original.core.user_results.result.core.screen_name = "original_poster";
    const repost = tweet("222", "700");
    repost.core.user_results.result.core.screen_name = "retweeter";
    const container = location === "legacy" ? repost.legacy : repost;
    container.retweeted_status_result = { result: original };
    const results = media.extractMedia(repost);
    assert.equal(results.length, 1);
    assert.equal(results[0].tweetId, "111");
    assert.equal(results[0].author, "original_poster");
    assert.equal(
      media.filename(results[0], results[0].variants[0]),
      "twitter/@original_poster/twitter_original_poster_111_700_1280x720.mp4",
    );
  }
});

test("legacy retweets use the original's user rather than the reposter", () => {
  const original = tweet("111").legacy;
  original.user = { screen_name: "original_poster" };
  const repost = tweet("222").legacy;
  repost.user = { screen_name: "retweeter" };
  repost.retweeted_status = original;
  const [result] = media.extractMedia(repost);
  assert.equal(result.author, "original_poster");
  assert.equal(result.tweetId, "111");
});

test("quoted videos retain each post's own author", () => {
  const outer = tweet("111", "700");
  outer.core.user_results.result.core.screen_name = "commentator";
  const quoted = tweet("222", "800");
  quoted.core.user_results.result.core.screen_name = "original_poster";
  outer.quoted_status_result = { result: quoted };
  const results = media.extractMedia(outer);
  assert.equal(
    results.find((item) => item.mediaId === "700").author,
    "commentator",
  );
  assert.equal(
    results.find((item) => item.mediaId === "800").author,
    "original_poster",
  );
});

test("missing author metadata uses an unknown folder without guessing", () => {
  const input = tweet();
  delete input.core;
  const [result] = media.extractMedia(input);
  assert.equal(result.author, "");
  assert.equal(
    media.filename(result, result.variants[0]),
    "twitter/@unknown/twitter_video_123456789_700_1280x720.mp4",
  );
});

test("extracts legacy payloads and animated GIF variants without bitrate", () => {
  const legacy = tweet().legacy;
  legacy.user = { screen_name: "legacy_user" };
  legacy.extended_entities.media[0].type = "animated_gif";
  legacy.extended_entities.media[0].video_info.variants = [
    { content_type: "video/mp4", url: mp4() },
  ];
  const [result] = media.extractMedia(legacy);
  assert.equal(result.author, "legacy_user");
  assert.equal(result.variants[0].bitrate, 0);
});

test("omits photos and HLS-only videos", () => {
  const input = tweet();
  input.legacy.extended_entities.media[0].video_info.variants = [
    input.legacy.extended_entities.media[0].video_info.variants[0],
  ];
  assert.equal(media.extractMedia(input).length, 0);
  delete input.legacy.extended_entities.media[0].video_info;
  assert.equal(media.extractMedia(input).length, 0);
});

test("deduplicates variants and handles cycles and missing data", () => {
  const input = tweet();
  input.cycle = input;
  const variants = input.legacy.extended_entities.media[0].video_info.variants;
  variants.push(variants[1]);
  assert.equal(media.extractMedia(input)[0].variants.length, 2);
  assert.equal(media.extractMedia(null).length, 0);
  assert.equal(
    media.extractMedia({ data: { result: { tombstone: true } } }).length,
    0,
  );
});

test("accepts only exact HTTPS Twitter MP4 CDN URLs", () => {
  assert.equal(media.videoUrl(mp4()), mp4());
  for (const url of [
    "https://video.twimg.com.evil.test/clip.mp4",
    "https://evil.test/video.twimg.com/clip.mp4",
    "http://video.twimg.com/clip.mp4",
    "https://video.twimg.com:444/clip.mp4",
    "https://name:password@video.twimg.com/clip.mp4",
    "https://video.twimg.com/clip.mp4#fragment",
    "javascript:alert(1)",
    "data:video/mp4,abc",
    "blob:https://x.com/clip",
    "https://video.twimg.com/clip.m3u8",
    "https://video.twimg.com/clip.exe",
  ])
    assert.equal(media.videoUrl(url), null, url);
});

test("rejects invalid IDs and sanitizes filenames without path traversal", () => {
  const input = {
    tweetId: "123",
    mediaId: "456",
    author: "../../bad<script>",
    variants: [{ url: mp4() }],
  };
  const normalized = media.normalizeMedia(input);
  assert.equal(normalized.author, "badscript");
  assert.equal(
    media.filename(input, input.variants[0]),
    "twitter/@badscript/twitter_badscript_123_456_1280x720.mp4",
  );
  assert.equal(media.normalizeMedia({ ...input, tweetId: "../123" }), null);
  assert.equal(media.normalizeMedia({ ...input, mediaId: "x" }), null);
  assert.equal(
    media.normalizeMedia({
      ...input,
      variants: [{ url: "https://evil.test/clip.mp4" }],
    }),
    null,
  );
});

test("restricts page access to exact X and Twitter origins", () => {
  for (const value of [
    "https://x.com/home",
    "https://www.twitter.com/u/status/123",
  ])
    assert.equal(media.isTwitterPage(value), true);
  for (const value of [
    "https://x.com.evil.test",
    "http://x.com",
    "https://other.test",
    "invalid",
  ])
    assert.equal(media.isTwitterPage(value), false);
});

test("normalizes photo originals and keeps image formats and dimensions", () => {
  const input = tweet();
  input.legacy.extended_entities.media = [
    photo(),
    photo("901", "secondPhoto", "png"),
  ];
  const results = media.extractMedia(input);
  assert.equal(results.length, 2);
  assert.equal(results[0].kind, "image");
  assert.equal(results[0].author, "example");
  assert.equal(
    results[0].variants[0].url,
    "https://pbs.twimg.com/media/fixturePhoto?format=jpg&name=orig",
  );
  assert.equal(
    media.filename(results[0], results[0].variants[0]),
    "twitter/@example/twitter_example_123456789_900_2048x1365.jpg",
  );
  assert.equal(
    media.filename(results[1], results[1].variants[0]),
    "twitter/@example/twitter_example_123456789_901_2048x1365.png",
  );
  assert.equal(
    media.imageUrl(
      "https://pbs.twimg.com/media/fixturePhoto?name=small&format=jpeg",
    ),
    "https://pbs.twimg.com/media/fixturePhoto?format=jpg&name=orig",
  );
});

test("images and videos coexist and retweeted albums use the original author", () => {
  const original = tweet();
  original.core.user_results.result.core.screen_name = "photographer";
  original.legacy.extended_entities.media.push(
    photo(),
    photo("901", "secondPhoto"),
  );
  const repost = tweet("987");
  repost.core.user_results.result.core.screen_name = "retweeter";
  repost.legacy.extended_entities.media =
    original.legacy.extended_entities.media;
  repost.legacy.retweeted_status_result = { result: original };
  const results = media.extractMedia(repost);
  assert.equal(results.length, 3);
  assert.equal(results.filter((item) => item.kind === "image").length, 2);
  for (const item of results) {
    assert.equal(item.tweetId, "123456789");
    assert.equal(item.author, "photographer");
  }
});

test("rejects non-photo CDN paths, executable formats and spoofed image hosts", () => {
  for (const url of [
    "http://pbs.twimg.com/media/photo.jpg",
    "https://pbs.twimg.com.evil.test/media/photo.jpg",
    "https://user@pbs.twimg.com/media/photo.jpg",
    "https://pbs.twimg.com:444/media/photo.jpg",
    "https://pbs.twimg.com/profile_images/123/avatar.jpg",
    "https://pbs.twimg.com/ext_tw_video_thumb/123/photo.jpg",
    "https://pbs.twimg.com/media/photo.svg",
    "https://pbs.twimg.com/media/photo?format=html",
    "https://pbs.twimg.com/media/photo.jpg?format=svg",
    "https://pbs.twimg.com/media/photo.jpg#fragment",
    "https://pbs.twimg.com/media/photo",
    "https://evil.test/photo.jpg",
  ])
    assert.equal(media.imageUrl(url), null, url);
  assert.equal(
    media.normalizeMedia({
      tweetId: "123",
      mediaId: "900",
      kind: "video",
      variants: [{ url: photo().media_url_https }],
    }),
    null,
  );
  assert.equal(
    media.normalizeMedia({
      tweetId: "123",
      mediaId: "900",
      kind: "image",
      variants: [{ url: mp4() }],
    }),
    null,
  );
});
