// Brief 4: one looped clip is the background of the whole site.
// Source clips rarely loop cleanly, so the tail is cross-faded back into the
// head (offset = D - 2), then encoded to MP4 (H.264) + WebM (VP9) under 6 MB
// each, plus a WebP poster taken from the first frame.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import ffmpeg from "ffmpeg-static";

const SRC = "background-nuvo.mp4";
const OUT = "public/video";
const XFADE = 1; // seconds of cross-fade
const SCALE = "scale=1920:1080:flags=lanczos,fps=30";

const run = (args) => execFileSync(ffmpeg, ["-hide_banner", "-y", ...args], { stdio: "inherit" });

function duration(file) {
  const out = execFileSync(ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(out);
  if (!m) throw new Error("cannot read duration");
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

function probe(file) {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stderr || "").toString();
  }
  return "";
}

const d = (() => {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe(SRC));
  if (!m) throw new Error("cannot read duration of " + SRC);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
})();

const offset = (Math.floor(d * 100) / 100) - 2 * XFADE + XFADE; // head is cut off the front, so the body is d - XFADE long
const loop = `[0:v]${SCALE}[v];[v]split[a][b];[a]trim=0:${XFADE},setpts=PTS-STARTPTS[h];[b]trim=${XFADE},setpts=PTS-STARTPTS[t];[t][h]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(2)}[out]`;

mkdirSync(OUT, { recursive: true });

console.log(`source ${d.toFixed(2)}s -> loop ${(d - XFADE).toFixed(2)}s, xfade at ${offset.toFixed(2)}s`);

run(["-i", SRC, "-filter_complex", loop, "-map", "[out]", "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-profile:v", "high", "-movflags", "+faststart", `${OUT}/bg-loop.mp4`]);

run(["-i", SRC, "-filter_complex", loop, "-map", "[out]", "-an",
  "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1",
  "-cpu-used", "3", "-pix_fmt", "yuv420p", `${OUT}/bg-loop.webm`]);

run(["-i", SRC, "-frames:v", "1", "-vf", "scale=1920:1080:flags=lanczos",
  "-c:v", "libwebp", "-quality", "86", "-compression_level", "6", `${OUT}/bg-poster.webp`]);

for (const f of ["bg-loop.mp4", "bg-loop.webm", "bg-poster.webp"]) {
  const mb = statSync(`${OUT}/${f}`).size / 1024 / 1024;
  console.log(`${f}  ${mb.toFixed(2)} MB${mb > 6 ? "  <-- over the 6 MB budget" : ""}`);
}
