# Verifying the Desktop Engine download

A SHA-256 checksum proves the file you downloaded matches the checksum published with that release. It does **not** prove who built the file or that it is safe. Code signing (Authenticode / SignPath) answers “who signed this?”; a matching Git commit + reproducible build answers “which source produced it?”

## Where the files live

Verification files are **GitHub Release assets**, not paths on the `main` branch:

| Asset | Purpose |
|-------|---------|
| `NexusHub-Desktop-Engine.zip` | **Preferred** Windows download (contains the `.exe`) |
| `NexusHub-Desktop-Engine.zip.sha256` | SHA-256 of the zip |
| `NexusHub-Desktop-Engine.exe` | Raw binary (optional direct download) |
| `NexusHub-Desktop-Engine.exe.sha256` | SHA-256 of the exe |
| `VERIFY.md` | Per-release commit / builtAt / hash copy |
| `NexusHub-Desktop-Engine-<version>.cdx.json` | CycloneDX SBOM |

Example (replace the tag):

- https://github.com/R1GAS/nexushub/releases/tag/v0.4.6
- https://github.com/R1GAS/nexushub/releases/download/v0.4.6/VERIFY.md
- https://github.com/R1GAS/nexushub/releases/download/v0.4.6/NexusHub-Desktop-Engine.exe.sha256

Stable process docs also live in this repo: [`ENGINE-SECURITY.md`](./ENGINE-SECURITY.md).

## Check the hash (Windows)

```powershell
# After downloading both the .exe and the .sha256 sidecar into the same folder:
Get-FileHash .\NexusHub-Desktop-Engine.exe -Algorithm SHA256
Get-Content .\NexusHub-Desktop-Engine.exe.sha256
```

The hex digests must match (ignore the trailing filename on the `.sha256` line).

## Check the hash (macOS / Linux)

```bash
shasum -a 256 NexusHub-Desktop-Engine.exe
# or: sha256sum NexusHub-Desktop-Engine.exe
cat NexusHub-Desktop-Engine.exe.sha256
```

## Three questions (trust checklist)

1. **Has this file changed since release?** Compare SHA-256 to the release `.sha256` / `VERIFY.md`.
2. **Which source produced it?** `VERIFY.md` lists `commit` and `builtAt`. That commit should exist on GitHub and contain the Engine sources (`engine-main.js`, `engine-security.js`, `engine-remux.js`). Prefer tags whose commit matches a pushed tree — not a dirty local build.
3. **Who signed this?** Until Authenticode / SignPath is in place, Windows will not show a verified publisher. Treat the hash + commit as the current trust path.

## Rebuild locally (optional)

```bash
npm run build:engine:win
# Produces engine-dist/NexusHub-Desktop-Engine.exe + .sha256 + VERIFY.md + SBOM
```

Compare your local hash to the published release only if you built from the **same** commit.
