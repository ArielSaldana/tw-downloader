const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const {
  imageUrl,
  videoUrl,
  photo,
  video,
  carousel,
} = require("./fixtures.cjs");
const context = vm.createContext({ URL });
vm.runInContext(
  readFileSync("plugins/ig-downloader/extension/media.js", "utf8"),
  context,
);
const media = context.__IG_DOWNLOADER_MEDIA_V1__;

test("Instagram extracts feed images and preserves signed CDN query strings", () => {
  const [item] = media.extractMedia({ items: [photo()] });
  assert.equal(item.kind, "image");
  assert.equal(item.author, "original.poster");
  assert.equal(item.variants[0].url, imageUrl());
  assert.equal(item.variants[0].width, 1080);
  assert.equal(
    media.filename(item, item.variants[0]),
    "instagram/@original.poster/instagram_original.poster_FixturePost_900_1080x1350.jpg",
  );
});
test("Instagram reels sort complete MP4 variants by resolution", () => {
  const [item] = media.extractMedia({ media_or_ad: video() });
  assert.equal(item.kind, "video");
  assert.equal(item.variants[0].url, videoUrl());
  assert.equal(item.previews[0], imageUrl("poster"));
  assert.equal(
    media.filename(item, item.variants[0]),
    "instagram/@original.poster/instagram_original.poster_FixtureReel_700_1080x1920.mp4",
  );
});
test("Instagram carousels keep the album owner's attribution and omit duplicate covers", () => {
  const items = media.extractMedia({ data: { carousel: carousel() } });
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.author, "album.owner");
    assert.equal(item.code, "FixtureAlbum");
    assert.equal(item.postId, "12345");
  }
  assert.equal(new Set(items.map((item) => item.mediaId)).size, 2);
});
test("Instagram GraphQL sidecars and video nodes are supported", () => {
  const root = {
    id: "99",
    shortcode: "GraphAlbum",
    owner: { username: "graph.owner" },
    edge_media_to_caption: { edges: [{ node: { text: "Graph caption" } }] },
    edge_sidecar_to_children: {
      edges: [
        {
          node: {
            id: "91",
            __typename: "GraphImage",
            display_resources: [
              {
                src: imageUrl("graph"),
                config_width: 2048,
                config_height: 1365,
              },
            ],
          },
        },
        {
          node: {
            id: "92",
            __typename: "GraphVideo",
            video_url: videoUrl("graph"),
            display_url: imageUrl("graphposter"),
            dimensions: { width: 720, height: 1280 },
          },
        },
      ],
    },
  };
  const items = media.extractMedia({ data: { xdt_shortcode_media: root } });
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "Graph caption");
  assert.ok(items.every((item) => item.author === "graph.owner"));
  assert.equal(items[1].variants[0].width, 720);
});
test("Instagram repost wrappers cannot replace the original owner", () => {
  const original = photo();
  original.user.username = "original.owner";
  const wrapper = {
    ...photo("800"),
    user: { username: "reposter" },
    original_media: original,
  };
  const items = media.extractMedia(wrapper);
  assert.equal(items.length, 1);
  assert.equal(items[0].author, "original.owner");
});
test("Instagram excludes stories, live streams, DASH-only video covers and profile pictures", () => {
  const live = { ...video(), is_live: true };
  const story = { ...photo(), expiring_at: 1234 };
  const dash = {
    ...video(),
    video_versions: [],
    video_dash_manifest: "<MPD/>",
  };
  for (const input of [
    live,
    story,
    dash,
    { user: { profile_pic_url: imageUrl() } },
  ])
    assert.equal(media.extractMedia(input).length, 0);
});
test("Instagram validates CDN suffix boundaries, schemes, file types and whole-file URLs", () => {
  assert.equal(media.videoUrl(videoUrl()), videoUrl());
  assert.ok(
    media.imageUrl(
      "https://scontent.cdg4-2.fna.fbcdn.net/v/t51/photo.webp?oh=signature",
    ),
  );
  for (const url of [
    "https://cdninstagram.com.evil.test/a.mp4",
    "https://evilcdninstagram.com/a.mp4",
    "http://scontent.cdninstagram.com/a.mp4",
    "https://user:secret@scontent.cdninstagram.com/a.mp4",
    "https://scontent.cdninstagram.com:444/a.mp4",
    videoUrl() + "#fragment",
    videoUrl() + "&bytestart=0&byteend=100",
    "blob:https://www.instagram.com/x",
    "data:video/mp4,abc",
    "https://scontent.cdninstagram.com/a.m3u8",
  ])
    assert.equal(media.videoUrl(url), null, url);
  for (const url of [
    "https://scontent.cdninstagram.com/a.svg",
    "https://scontent.cdninstagram.com/a.html",
    "https://www.instagram.com/a.jpg",
    videoUrl(),
  ])
    assert.equal(media.imageUrl(url), null, url);
});
test("Instagram unknown owners are explicit and handles cannot escape their folder", () => {
  const input = photo();
  delete input.user;
  const [item] = media.extractMedia(input);
  assert.match(
    media.filename(item, item.variants[0]),
    /^instagram\/@unknown\//,
  );
  const safe = media.normalizeMedia({ ...item, author: "../../strange/owner" });
  assert.equal(safe.author, "strangeowner");
  assert.equal(media.normalizeMedia({ ...item, mediaId: "../file" }), null);
  assert.equal(media.normalizeMedia({ ...item, code: "../file" }), null);
});
test("Instagram computes shortcodes with BigInt and rejects spoofed page origins", () => {
  assert.equal(media.shortcode("64_900"), "BA");
  assert.equal(media.shortcode(9007199254740992), "");
  assert.equal(
    media.postCode("https://www.instagram.com/reel/ABC-def_123/"),
    "ABC-def_123",
  );
  assert.equal(
    media.postCode("https://www.instagram.com/nasa/reel/ABC-def_123/"),
    "ABC-def_123",
  );
  assert.equal(
    media.postCode("https://www.instagram.com/nasa.webb/p/ABC-def_123/"),
    "ABC-def_123",
  );
  assert.equal(media.postCode("https://instagram.com.evil.test/p/ABC/"), "");
  assert.equal(media.isInstagramPage("http://instagram.com/p/ABC/"), false);
});
test("Instagram extraction is bounded and cycle-safe", () => {
  const input = video();
  input.cycle = input;
  assert.equal(media.extractMedia(input).length, 1);
  assert.equal(media.extractMedia(null).length, 0);
});
