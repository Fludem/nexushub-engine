"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const remux = require("../engine-remux");

const params = (q) => new URLSearchParams(q);

test("parseRemuxQuery rejects unknown keys so FFmpeg flags cannot be smuggled", () => {
  const res = remux.parseRemuxQuery(params("url=https://cdn.example/a.mkv&vf=scale"));
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /Unknown remux parameter: vf/);
});

test("parseRemuxQuery requires url and only allows vcodec=h264", () => {
  assert.equal(remux.parseRemuxQuery(params("")).status, 400);
  assert.equal(remux.parseRemuxQuery(params("url=https://x/a.mkv&vcodec=hevc")).status, 400);
  const ok = remux.parseRemuxQuery(params("url=https://x/a.mkv&vcodec=h264&token=t"));
  assert.equal(ok.ok, true);
  assert.equal(ok.transcodeVideo, true);
  assert.equal(remux.parseRemuxQuery(params("url=https://x/a.mkv&transcode=1")).transcodeVideo, true);
  assert.equal(remux.parseRemuxQuery(params("url=https://x/a.mkv")).transcodeVideo, false);
});

test("buildFfmpegArgs uses fixed templates with the URL as the only -i input", () => {
  const url = "https://cdn.example/a.mkv?sig=1";
  const copy = remux.buildFfmpegArgs(url);
  assert.equal(copy[copy.indexOf("-i") + 1], url);
  assert.equal(copy.filter((a) => a === "-i").length, 1);
  assert.deepEqual(copy.slice(copy.indexOf("-c:v"), copy.indexOf("-c:v") + 2), ["-c:v", "copy"]);
  assert.equal(copy[copy.length - 1], "pipe:1");

  const tx = remux.buildFfmpegArgs(url, { transcodeVideo: true });
  assert.equal(tx[tx.indexOf("-c:v") + 1], "libx264");
});

test("sanitizeFfmpegBinary only accepts an existing file named ffmpeg", () => {
  assert.equal(remux.sanitizeFfmpegBinary(""), "");
  assert.equal(remux.sanitizeFfmpegBinary("/bin/sh"), "");
  assert.equal(remux.sanitizeFfmpegBinary("/nonexistent/ffmpeg"), "");
  assert.equal(remux.sanitizeFfmpegBinary("ffmpeg\n--evil"), "");
});

test("buildFfmpegArgs pins FFmpeg input protocols to network-only", () => {
  const args = remux.buildFfmpegArgs("https://cdn.example/a.m3u8");
  const i = args.indexOf("-protocol_whitelist");
  assert.ok(i !== -1 && i < args.indexOf("-i"));
  assert.equal(args[i + 1], "http,https,tcp,tls,crypto");
});
