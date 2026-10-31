const imageUrl = (id = "photo1") => `https://i.redd.it/${id}.jpg`;
const videoUrl = (file = "DASH_720.mp4") => `https://v.redd.it/clip1/${file}`;
const photo = () => ({
  name: "t3_abc123",
  author: "original_poster",
  title: "A photo <script>unsafe()</script>",
  permalink: "/r/test/comments/abc123/photo/",
  url_overridden_by_dest: imageUrl(),
  preview: {
    images: [
      {
        source: {
          url: "https://preview.redd.it/photo1.jpg?width=1200&amp;s=signature",
          width: 1200,
          height: 800,
        },
      },
    ],
  },
});
const video = () => ({
  ...photo(),
  name: "t3_def456",
  permalink: "/r/test/comments/def456/video/",
  url_overridden_by_dest: "https://v.redd.it/clip1",
  media: {
    reddit_video: {
      fallback_url: videoUrl(),
      dash_url: videoUrl("DASHPlaylist.mpd"),
      width: 160,
      height: 90,
      is_gif: false,
    },
  },
});
const gallery = () => ({
  ...photo(),
  name: "t3_aaa111",
  is_gallery: true,
  gallery_data: { items: [{ media_id: "photo1" }, { media_id: "photo2" }] },
  media_metadata: {
    photo1: {
      status: "valid",
      e: "Image",
      s: {
        u: "https://preview.redd.it/photo1.jpg?width=1200&amp;s=sig",
        x: 1200,
        y: 800,
      },
    },
    photo2: {
      status: "valid",
      e: "AnimatedImage",
      s: { mp4: "https://preview.redd.it/photo2.mp4?s=sig", x: 600, y: 400 },
    },
  },
});
const manifest = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4"><Representation width="160" height="90" bandwidth="500000"><BaseURL>DASH_720.mp4</BaseURL><SegmentBase/></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation bandwidth="128000"><BaseURL>DASH_AUDIO_128.mp4</BaseURL><SegmentBase/></Representation></AdaptationSet></Period></MPD>`;
module.exports = { imageUrl, videoUrl, photo, video, gallery, manifest };
