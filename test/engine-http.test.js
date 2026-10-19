"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ALLOWED_ORIGIN, startEngine } = require("./helpers");

let engine;
test.before(async () => {
  engine = await startEngine();
});
test.after(async () => {
  if (engine) await engine.stop();
});

const enc = encodeURIComponent;

test("/health is unauthenticated and identifies the engine", async () => {
  const res = await engine.request("/health?json=1");
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text);
  assert.equal(body.ok, true);
  assert.equal(body.role, "local-stream-proxy");
});

test("/engine only issues the session token to allowlisted origins", async () => {
  assert.match(engine.token, /^[0-9a-f]{64}$/);
  const noOrigin = JSON.parse((await engine.request("/engine")).text);
  assert.equal(noOrigin.sessionToken, undefined);
  const evil = JSON.parse((await engine.request("/engine", { headers: { Origin: "https://evil.example" } })).text);
  assert.equal(evil.sessionToken, undefined);
});

test("/proxy requires the session token", async () => {
  const res = await engine.request(`/proxy?url=${enc("https://1.1.1.1/")}`);
  assert.equal(res.status, 403);
  assert.match(res.text, /session token/);
});

test("/proxy rejects disallowed origins even with a valid token", async () => {
  const res = await engine.request(`/proxy?url=${enc("https://1.1.1.1/")}&token=${engine.token}`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(res.status, 403);
});

test("/proxy refuses loopback upstreams", async () => {
  const self = `http://127.0.0.1:${engine.port}/health`;
  const res = await engine.request(`/proxy?url=${enc(self)}&token=${engine.token}`);
  assert.equal(res.status, 502);
  assert.match(res.text, /Blocked destination/);
});

test("/quit is POST + token only", async () => {
  assert.equal((await engine.request("/quit", { method: "GET" })).status, 405);
  const originOnly = await engine.request("/quit", { method: "POST", headers: { Origin: ALLOWED_ORIGIN } });
  assert.equal(originOnly.status, 403);
});

test("CORS preflight from a disallowed origin is refused", async () => {
  const res = await engine.request("/proxy", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});
