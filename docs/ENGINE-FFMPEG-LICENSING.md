# Desktop Engine + FFmpeg licensing

Not legal advice. This is how NexusHub ships FFmpeg today and how to change it later.

## Model: separate sidecar (recommended)

The Engine **spawns** `ffmpeg.exe` as a separate process (`spawn` / no `shell`). It does not link FFmpeg into the Engine binary.

- **NexusHub Desktop Engine** — your product license / terms.
- **`ffmpeg.exe`** — its own license (currently a **GPL** essentials build because we use **`libx264`** for H.264 transcode rescue).

Shipping an installer vs a zip does **not** change that split. The installer just installs both files into one folder and drops license notices beside them.

## Keeping GPL and staying compliant (practical checklist)

When the release includes GPL FFmpeg (e.g. Gyan essentials with libx264):

1. Ship **license / notices** next to `ffmpeg.exe` (see `packaging/ffmpeg-notices/`).
2. Tell users **where to get Corresponding Source** for that exact build (URL + version in `SOURCE.txt` / notices).
3. Do **not** strip copyright / license files from the FFmpeg build.
4. Keep invoking FFmpeg as an external binary (current remux code).
5. Optional but good: mention in the release notes that remux uses a GPL FFmpeg sidecar.

GPL allows commercial use; it requires compliance with the GPL for **that** binary, not that the whole NexusHub SPA must be GPL.

## Easy license / codec swap later

| Goal | What to change |
|------|----------------|
| Stay GPL + `libx264` | Keep current `scripts/fetch-engine-ffmpeg.js` URL; refresh notices if the build URL changes. |
| Move to LGPL | Point fetch at an LGPL build; change `engine-remux.js` off `libx264` (e.g. OpenH264 or drop transcode → VLC); replace notices. |
| Installer unchanged | Same Inno script — it installs whatever `engine-dist/ffmpeg.exe` + notices you put in the payload. |

No need to redesign the installer to change licensing — only the **payload** and, for LGPL, the **encoder flags**.

## Install location

Default Windows install (per-user, no admin):

`%LOCALAPPDATA%\NexusHub\Desktop Engine\`

Contains `NexusHub-Desktop-Engine.exe`, `ffmpeg.exe`, and FFmpeg notices.
