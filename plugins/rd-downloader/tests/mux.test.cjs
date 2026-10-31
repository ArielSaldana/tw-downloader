const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createFile } = require("mp4box");
const context = vm.createContext({
  ArrayBuffer,
  Uint8Array,
  DataView,
  TextDecoder,
  TextEncoder,
  console,
});
vm.runInContext(
  fs.readFileSync("plugins/rd-downloader/extension/mux.js", "utf8"),
  context,
);
const buffer = (name) => {
  const data = fs.readFileSync(`${__dirname}/assets/${name}.mp4`);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.length);
};
function parsed(data) {
  const file = createFile(true);
  data.fileStart = 0;
  file.appendBuffer(data);
  file.flush();
  return file;
}
for (const name of ["video", "fragmented"])
  test(`Reddit locally combines ${name} MP4 with intact audio samples`, () => {
    const output = context.RedditMux.mux(buffer(name), buffer("audio"));
    const file = parsed(output),
      info = file.getInfo();
    assert.equal(info.videoTracks.length, 1);
    assert.equal(info.audioTracks.length, 1);
    for (const [type, sourceName] of [
      ["videoTracks", name],
      ["audioTracks", "audio"],
    ]) {
      const input = parsed(buffer(sourceName));
      const sourceTrack = input.getTrackById(input.getInfo()[type][0].id);
      const track = file.getTrackById(info[type][0].id);
      assert.equal(track.samples.length, sourceTrack.samples.length);
      for (let i = 0; i < track.samples.length; i++)
        assert.deepEqual(
          Buffer.from(file.getSample(track, i).data),
          Buffer.from(input.getSample(sourceTrack, i).data),
        );
    }
    assert.equal(context.RedditMux.hasAudio(output), true);
  });
test("Reddit mux rejects incomplete and invalid tracks", () => {
  assert.equal(context.RedditMux.hasAudio(buffer("video")), false);
  assert.throws(
    () => context.RedditMux.mux(new ArrayBuffer(12), buffer("audio")),
    /invalid MP4/,
  );
  assert.throws(
    () => context.RedditMux.mux(buffer("video"), buffer("video")),
    /missing/,
  );
});
