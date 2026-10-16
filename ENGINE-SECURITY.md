# NexusHub Desktop Engine — security

Design goal: users should not need to trust intentions. The Engine is a **local media proxy + optional remux helper** bound to the loopback interface. Unexpected privilege or network expansion should be difficult by construction.

See also: public Engine review repo [`nexushub-engine`](https://github.com/R1GAS/nexushub-engine) — [`engine-main.js`](https://github.com/R1GAS/nexushub-engine/blob/main/engine-main.js), [`engine-security.js`](https://github.com/R1GAS/nexushub-engine/blob/main/engine-security.js), [`engine-remux.js`](https://github.com/R1GAS/nexushub-engine/blob/main/engine-remux.js). The full NexusHub app repo is private.

## What it does

- Listen on `127.0.0.1:8787` (override with `NEXUSHUB_PROXY_HOST` / `NEXUSHUB_PROXY_PORT`)
- Proxy HTTP(S) media / playlists for allowlisted NexusHub web origins
- Optional FFmpeg remux/transcode of a single upstream URL to browser-playable MP4

## What it must not do

- Bind to `0.0.0.0` by default
- Proxy to loopback, private LAN, link-local, or cloud metadata addresses
- Accept arbitrary URL schemes (`file:`, `ftp:`, `javascript:`, …)
- Download or execute extra binaries at runtime (FFmpeg is discovered on PATH / env only)
- Collect telemetry by default

## Phase 1 (implemented)

### Session token

- On startup the Engine generates a random `sessionToken`.
- `/engine` returns `sessionToken` **only** when the request `Origin` is an allowlisted NexusHub origin (CORS-readable by the web app).
- `/proxy`, `/remux`, `/resolve`, and `/logo` require that token (`?token=`, `Authorization: Bearer`, or `X-NexusHub-Token`).
- Rewritten HLS playlists embed the token in segment proxy URLs (media elements often omit `Origin`).
- `/health` stays unauthenticated (liveness only; no token, no upstream fetch).

### SSRF / destination checks

- Only `http:` and `https:` upstreams.
- No URL userinfo.
- DNS resolution is checked; loopback, RFC1918, link-local, CGNAT, and metadata ranges are blocked.
- Redirects are re-validated on every hop.

### Limits

- Max URL length, redirect hops, concurrent upstream fetches, and buffered response size (see `engine-security.js` / env overrides).
- Logs use host + path only — not query strings (avoids signed CDN secrets / credentials).

### Env knobs

| Variable | Purpose |
|----------|---------|
| `NEXUSHUB_PROXY_HOST` | Bind host (default `127.0.0.1`) |
| `NEXUSHUB_PROXY_PORT` | Bind port (default `8787`) |
| `NEXUSHUB_ALLOWED_ORIGINS` | Comma-separated web origins |
| `NEXUSHUB_MAX_URL_LENGTH` | Upstream URL length cap |
| `NEXUSHUB_MAX_REDIRECTS` | Redirect hop cap |
| `NEXUSHUB_MAX_BUFFER_BYTES` | Max buffered upstream body |
| `NEXUSHUB_MAX_CONCURRENT` | Max parallel upstream fetches |

## Phase 2 (implemented) — remux lockdown

- Fixed FFmpeg argument templates only (`copy` or `libx264` + AAC); no user-supplied flags.
- `/remux` query allowlist: `url`, `token`, `transcode`, `vcodec=h264` — unknown keys → 400.
- Upstream URL SSRF-checked again inside remux (defense in depth).
- `spawn(..., { shell: false })`; minimal env; `cwd` = OS temp (pipe-only output, no temp media files).
- `NEXUSHUB_FFMPEG` must point at a real `ffmpeg` / `ffmpeg.exe` file.
- Discovery prefers known paths + `where.exe` (no PowerShell Path scrape).
- Default remux wall clock **2 hours** (`NEXUSHUB_REMUX_MAX_MS`); child killed on timeout, client disconnect, or Engine shutdown (`stopRemux`).

## Phase 3 (implemented) — Windows integration is opt-in

- **No auto protocol registration** on startup.
- Console stays **visible** unless `NEXUSHUB_ENGINE_HIDE=1`.
- Tray icon only if `NEXUSHUB_ENGINE_TRAY=1` (off by default).
- Protocol register/unregister via:
  - CLI: `--register-protocol` / `--unregister-protocol`
  - HTTP (session token): `/protocol/register` · `/protocol/unregister` · `/protocol/status`
  - Settings UI buttons (after Engine is running)
- Windows uses **`reg.exe`** under `HKCU` only (no admin, no service, no startup task).
- `nexushub-engine://…` launches only start the server — URL parameters are **not** executed as commands.
- `--diagnostics` prints bind address, tray/hide flags, protocol state, ffmpeg path, and what register would write — **makes no changes**.

## Phase 4 (implemented) — visibility + stop UX

- `/engine` and `/activity` report **active upstream hosts** (hostname only; no query strings).
- Kinds: `proxy`, `logo`, `resolve`, `remux`.
- Settings shows the active list (polls while online) and build identity when present.
- **Stop Engine** → `POST /quit` (session token / allowlisted origin). GET still accepted for older clients.
- **Stop remux** → `/remux/stop` (kills the FFmpeg child only).
- Opt-in tray (`NEXUSHUB_ENGINE_TRAY=1`) receives the session token via env and quits with `POST` + `X-NexusHub-Token`. Status starts at “Checking…”, verifies `/health?json=1` (name + pid), and disposes GDI resources on exit.

## Phase 5 (implemented) — reproducible release artifacts

- `engine-build-meta.js` is stamped at build time with `version`, `commit`, `builtAt`, `channel`.
- Exposed on `/engine` (`build`) and `--diagnostics`.
- `npm run build:engine:win` (or `:mac` / default) writes under `engine-dist/`:
  - binary / zip
  - `*.sha256` sidecar
  - CycloneDX 1.5 SBOM (`NexusHub-Desktop-Engine-<version>.cdx.json`)
  - `VERIFY.md` with hash-check instructions
- Optional Windows Authenticode: set `NEXUSHUB_SIGN_CERT` (+ optional `NEXUSHUB_SIGNTOOL`, `NEXUSHUB_SIGN_PASSWORD`, `NEXUSHUB_SIGN_TIMESTAMP`) before build.
- macOS public releases still need **codesign + notarize** on a Mac (Apple Developer ID) — the build script packages the `.app` / zip and checksums; it does not notarize.

Publish the binary **together with** its `.sha256` (and preferably `VERIFY.md` + SBOM). Users should verify the hash before running.

See also **[`ENGINE-VERIFY.md`](./ENGINE-VERIFY.md)** (stable how-to on `main`). Per-release `VERIFY.md` is attached to the GitHub Release assets — it is intentionally **not** a path under `engine-dist/` on `main` (that folder is gitignored except `README.txt`).

### Provenance honesty

- Stamping `commit` into the binary / `VERIFY.md` is only meaningful when that commit is **pushed** and contains the Engine sources that were packaged.
- Building from a dirty working tree and tagging `main` at an older commit is **not** reproducible provenance. Release procedure: commit → push → tag → `npm run build:engine:win` → upload assets with matching `VERIFY.md`.
- SHA-256 ≠ publisher identity. Authenticode / [SignPath Foundation](https://signpath.org/) (free OSS path) is still required for “Verified publisher” on Windows.

## Verifying Phase 1 locally

```bash
node engine-main.js
# From an allowlisted origin page, /engine should include sessionToken.
# curl without Origin must NOT receive sessionToken.
# curl /proxy?url=http://127.0.0.1/ without token → 403
# curl /proxy?url=http://127.0.0.1/&token=… → blocked destination
```

```bash
node scripts/test-engine-security.mjs
node engine-main.js --diagnostics   # should show version + commit
npm run build:engine:win            # SHA-256 + SBOM in engine-dist/
```

Rebuild the Windows `.exe` after Engine changes: `npm run build:engine:win`.
