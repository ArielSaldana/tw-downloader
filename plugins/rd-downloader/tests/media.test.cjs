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

test("Reddit MP4 GIF previews preserve signed URLs and are never classified as still images", () => {
  for (const host of ["preview.redd.it", "external-preview.redd.it"]) {
    const url = `https://${host}/animated.gif?width=640&format=mp4&s=signed`;
    assert.equal(m.videoUrl(url), url);
    assert.equal(m.imageUrl(url), null);
    const [item] = m.extractMedia({ ...photo(), url_overridden_by_dest: url });
    assert.equal(item.kind, "video");
    assert.equal(item.variants[0].url, url);
    assert.match(m.filename(item, item.variants[0]), /\.mp4$/);
  }
  const encoded =
    "https://external-preview.redd.it/animation?format=mp4&amp;s=signed#t=0";
  assert.equal(
    m.videoUrl(encoded),
    "https://external-preview.redd.it/animation?format=mp4&s=signed",
  );
});
test("Reddit MP4 preview variants, GIF-only previews, and animated galleries retain animation", () => {
  const animated = photo();
  animated.preview.images[0].variants = {
    mp4: {
      source: {
        url: "https://preview.redd.it/loop.gif?format=mp4&s=sig",
        width: 600,
        height: 400,
      },
    },
  };
  assert.equal(m.extractMedia(animated)[0].kind, "video");
  const album = gallery();
  album.media_metadata.photo2.s.mp4 =
    "https://preview.redd.it/photo2.gif?format=mp4&s=sig";
  assert.equal(m.extractMedia(album)[1].kind, "video");
  delete album.media_metadata.photo2.s.mp4;
  album.media_metadata.photo2.s.gif = "https://i.redd.it/photo2.gif";
  const gif = m.extractMedia(album)[1];
  assert.equal(gif.kind, "image");
  assert.match(m.filename(gif, gif.variants[0]), /\.gif$/);
  animated.url_overridden_by_dest = "https://example.org/animation";
  animated.preview.images[0].variants = {
    gif: {
      source: {
        url: "https://external-preview.redd.it/animation.gif?s=sig",
        width: 600,
        height: 400,
      },
    },
  };
  assert.equal(
    m.extractMedia(animated)[0].variants[0].url,
    "https://external-preview.redd.it/animation.gif?s=sig",
  );
});
test("Redgifs resolves a canonical clip reference instead of saving the Reddit preview", () => {
  const post = {
    ...video(),
    url_overridden_by_dest:
      "https://www.redgifs.com/ifr/CalmBlueOtter?autoplay=1",
  };
  const [item] = m.extractMedia(post);
  assert.equal(item.author, "original_poster");
  assert.equal(item.kind, "video");
  assert.equal(
    item.variants[0].url,
    "https://www.redgifs.com/watch/calmblueotter",
  );
  const embed = {
    ...photo(),
    url_overridden_by_dest: "https://example.org/",
    secure_media: {
      oembed: {
        html: '<iframe src="https://www.redgifs.com/ifr/CalmBlueOtter?foo=1&amp;bar=2"></iframe>',
      },
    },
  };
  assert.equal(m.extractMedia(embed)[0].variants[0].url, item.variants[0].url);
});
test("Redgifs and GIF host validation rejects spoofing and arbitrary embed URLs", () => {
  for (const url of [
    "http://www.redgifs.com/watch/calmblueotter",
    "https://www.redgifs.com.evil.test/watch/calmblueotter",
    "https://user@www.redgifs.com/watch/calmblueotter",
    "https://www.redgifs.com:444/watch/calmblueotter",
    "https://www.redgifs.com/users/calmblueotter",
    "https://www.redgifs.com/watch/bad%2Fid",
  ])
    assert.equal(m.redgifsId(url), "", url);
  for (const url of [
    "https://thumbs2.redgifs.com.evil.test/Clip.mp4",
    "https://api.redgifs.com/Clip.mp4",
    "https://evil.redgifs.com/Clip.mp4",
    "https://thumbs2.redgifs.com/Clip.exe",
    "https://external-preview.redd.it.evil.test/a.gif?format=mp4",
  ])
    assert.equal(m.videoUrl(url), null, url);
  assert.equal(
    m.redgifsMediaUrl(
      "https://thumbs44.redgifs.com/CalmBlueOtter-mobile.mp4#t=0",
    ),
    "https://thumbs44.redgifs.com/CalmBlueOtter-mobile.mp4",
  );
  assert.equal(
    m.assetKey("https://thumbs2.redgifs.com/CalmBlueOtter-mobile.mp4"),
    m.assetKey("https://www.redgifs.com/ifr/calmblueotter"),
  );
});
test("Direct Imgur GIF and GIFV links preserve their actual file types", () => {
  const [gif] = m.extractMedia({
    ...photo(),
    url_overridden_by_dest: "https://i.imgur.com/AbC123.gif",
  });
  assert.equal(gif.kind, "image");
  assert.match(m.filename(gif, gif.variants[0]), /\.gif$/);
  const [video] = m.extractMedia({
    ...photo(),
    url_overridden_by_dest: "https://i.imgur.com/AbC123.gifv",
  });
  assert.equal(video.kind, "video");
  assert.equal(video.variants[0].url, "https://i.imgur.com/AbC123.mp4");
});

test("Redgifs references stay preferred when a cached Reddit preview is merged", () => {
  const [item] = m.extractMedia({
    ...video(),
    url_overridden_by_dest: "https://www.redgifs.com/watch/calmblueotter",
  });
  const merged = m.normalizeMedia({
    ...item,
    variants: [
      { url: videoUrl(), width: 3840, height: 2160 },
      ...item.variants,
    ],
  });
  assert.equal(
    merged.variants[0].url,
    "https://www.redgifs.com/watch/calmblueotter",
  );
});
test("Supplied Reddit manifest URLs are retained rather than replaced with a guessed name", () => {
  assert.equal(
    m.manifestUrl("https://v.redd.it/clip1/CustomPlaylist.mpd?s=signed"),
    "https://v.redd.it/clip1/CustomPlaylist.mpd?s=signed",
  );
});
