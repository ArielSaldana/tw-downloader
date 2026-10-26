const mp4 = (quality = "1280x720", name = "clip") =>
  `https://video.twimg.com/ext_tw_video/700/pu/vid/avc1/${quality}/${name}.mp4?tag=12`;

function tweet(id = "123456789", mediaId = "700", overrides = {}) {
  return {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: { core: { screen_name: "example" } } } },
    legacy: {
      id_str: id,
      full_text: "A sample video <script>alert('no')</script>",
      extended_entities: {
        media: [
          {
            id_str: mediaId,
            type: "video",
            video_info: {
              variants: [
                {
                  content_type: "application/x-mpegURL",
                  url: "https://video.twimg.com/clip.m3u8",
                },
                {
                  content_type: "video/mp4",
                  bitrate: 256000,
                  url: mp4("480x270"),
                },
                { content_type: "video/mp4", bitrate: 2176000, url: mp4() },
              ],
            },
          },
        ],
      },
      ...overrides,
    },
  };
}

function photo(mediaId = "900", name = "fixturePhoto", format = "jpg") {
  return {
    id_str: mediaId,
    type: "photo",
    media_url_https: `https://pbs.twimg.com/media/${name}.${format}`,
    original_info: { width: 2048, height: 1365 },
  };
}

module.exports = { mp4, tweet, photo };
