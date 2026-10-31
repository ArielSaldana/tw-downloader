import { createFile } from "mp4box";

function parse(buffer) {
  const file = createFile(true);
  let failure;
  file.onError = (error) => {
    failure = error;
  };
  buffer.fileStart = 0;
  file.appendBuffer(buffer);
  file.flush();
  if (failure || !file.moov)
    throw new Error(
      "Reddit returned an invalid MP4. Refresh the post and try again.",
    );
  return file;
}
export function hasAudio(buffer) {
  return parse(buffer).getInfo().audioTracks.length > 0;
}
export function mux(videoBuffer, audioBuffer) {
  const sources = [parse(videoBuffer), parse(audioBuffer)];
  const output = createFile();
  const movieTimescale = sources[0].moov.mvhd.timescale;
  output.init({ timescale: movieTimescale });
  const samples = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const info = source.getInfo();
    const track = (i === 0 ? info.videoTracks : info.audioTracks)[0];
    if (!track || track.nb_samples > 500000)
      throw new Error(
        "The Reddit MP4 is missing a supported video or audio track.",
      );
    const original = source.getTrackById(track.id);
    const entries = original.mdia.minf.stbl.stsd.entries;
    if (
      entries.length !== 1 ||
      ![
        "avc1",
        "avc3",
        "hvc1",
        "hev1",
        "av01",
        "vp09",
        "mp4a",
        "Opus",
      ].includes(entries[0].type)
    )
      throw new Error("This Reddit video codec is not supported.");
    const sampleEnd = original.samples.reduce(
      (end, sample) => Math.max(end, sample.cts + sample.duration),
      0,
    );
    const duration = Math.round(
      (original.tkhd.duration
        ? original.tkhd.duration / source.moov.mvhd.timescale
        : sampleEnd / track.timescale) * movieTimescale,
    );
    const id = output.addTrack({
      type: entries[0].type,
      timescale: track.timescale,
      duration,
      media_duration: track.duration,
      hdlr: i === 0 ? "vide" : "soun",
      width: track.video?.width,
      height: track.video?.height,
      samplerate: track.audio?.sample_rate,
      channel_count: track.audio?.channel_count,
    });
    const created = output.getTrackById(id);
    created.mdia.minf.stbl.stsd.entries = entries;
    created.tkhd.matrix = original.tkhd.matrix;
    created.tkhd.width = original.tkhd.width;
    created.tkhd.height = original.tkhd.height;
    // Preserve presentation offsets, including AAC encoder delay.
    if (original.edts) {
      for (const entry of original.edts.elst.entries)
        entry.segment_duration = Math.round(
          (entry.segment_duration * movieTimescale) /
            source.moov.mvhd.timescale,
        );
      created.addBox(original.edts);
    }
    output.moov.mvhd.duration = Math.max(output.moov.mvhd.duration, duration);
    for (let index = 0; index < original.samples.length; index++) {
      const sample = source.getSample(original, index);
      if (!sample?.data || sample.data.byteLength !== sample.size)
        throw new Error("The Reddit MP4 download is incomplete.");
      samples.push({ id, sample });
    }
    if (!original.samples.length)
      throw new Error("The Reddit MP4 contains no media samples.");
  }
  samples.sort(
    (a, b) =>
      a.sample.dts / a.sample.timescale - b.sample.dts / b.sample.timescale,
  );
  for (const { id, sample } of samples)
    output.addSample(id, sample.data, {
      ...sample,
      sample_description_index: 1,
    });
  return output.getBuffer().buffer;
}
