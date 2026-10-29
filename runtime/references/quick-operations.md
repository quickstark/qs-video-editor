# Quick local operations

Use this route for a bounded trim, conversion, resize, audio extraction, or review encode. Work directly with the requested source and a new output. No Resolve, WhisperX, graphics renderer, story map, or full project brief is required unless the requested operation needs it.

1. Read applicable workspace instructions and establish source, output, and requested range/format from the request. Infer harmless defaults; ask only about an ambiguity that changes the result.
2. Probe the source. `probe-media.mjs --input <file> --hash` reports exact timing, streams, rotation, and color data. A direct ffprobe is also sufficient for a one-off operation. Run preflight if the local tools have not already been verified.
3. Write a new derivative. Use FFmpeg `-nostdin -n`, quote paths, explicitly map the streams you intend to retain, and leave originals unchanged. Do not carry location/device metadata unless requested. Metadata removal does not redact visible faces, words, or private content.
4. Check output metadata and decode integrity. Inspect boundary frames for a trim, and listen when sound is part of the output. Record exactly which checks were possible.

Examples below assume ordinary SDR material and already verified codecs. Adapt stream maps and color handling to the probe; do not silently tone-map HDR, drop wanted subtitle/audio tracks, or round a fractional source frame rate.

Accurate 10-second H.264/AAC trim starting at 12.5 seconds (re-encoded, not limited to keyframes):

```bash
ffmpeg -nostdin -n -i "source.mp4" -ss 12.5 -t 10 \
  -map 0:v:0 -map '0:a:0?' -map_metadata -1 -map_chapters -1 \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "trim-review.mp4"
```

Extract mono PCM audio for local transcription (this intentionally changes channel layout/sample rate):

```bash
ffmpeg -nostdin -n -i "source.mp4" -map 0:a:0 -vn \
  -map_metadata -1 -map_chapters -1 -ac 1 -ar 16000 -c:a pcm_s16le "scratch.wav"
```

Check decode integrity:

```bash
ffmpeg -nostdin -v error -i "trim-review.mp4" -map 0:v:0 -map '0:a:0?' -f null -
```

A stream-copy trim is appropriate only when keyframe-constrained timing is acceptable. A successful decode or ffprobe is technical evidence; it does not prove lip sync, intelligibility, or visual continuity. If the job grows into sustained editorial work, bootstrap/scaffold once and carry forward these outputs and commands.
