const imageUrl = (name = "moon", format = "jpg") =>
  `https://scontent-iad3-1.cdninstagram.com/v/t51.2885-15/${name}.${format}?stp=dst-jpg_e35&_nc_cat=1&oh=signed-image&oe=ABC`;
const videoUrl = (name = "clip") =>
  `https://scontent-iad3-1.cdninstagram.com/o1/v/t16/f1/m86/${name}.mp4?efg=signed-metadata&oh=keep-this&oe=ABC`;
function photo(id = "900", name = "moon", owner = "original.poster") {
  return {
    id,
    code: "FixturePost",
    media_type: 1,
    user: { username: owner },
    caption: { text: "A view worth keeping." },
    image_versions2: {
      candidates: [
        { url: imageUrl(name), width: 1080, height: 1350 },
        { url: imageUrl(name) + "&size=small", width: 360, height: 450 },
      ],
    },
  };
}
function video(id = "700", code = "FixtureReel") {
  return {
    id,
    code,
    media_type: 2,
    user: { username: "original.poster" },
    caption: { text: "A short reel <script>unsafe()</script>" },
    image_versions2: {
      candidates: [{ url: imageUrl("poster"), width: 720, height: 1280 }],
    },
    video_versions: [
      { url: videoUrl("small"), width: 360, height: 640 },
      { url: videoUrl(), width: 1080, height: 1920 },
    ],
  };
}
function carousel() {
  const image = photo();
  const reel = video();
  delete image.user;
  delete image.code;
  delete reel.user;
  delete reel.code;
  return {
    id: "12345",
    code: "FixtureAlbum",
    media_type: 8,
    user: { username: "album.owner" },
    caption: { text: "Photos and video together." },
    image_versions2: {
      candidates: [{ url: imageUrl(), width: 1080, height: 1350 }],
    },
    carousel_media: [image, reel],
  };
}
module.exports = { imageUrl, videoUrl, photo, video, carousel };
