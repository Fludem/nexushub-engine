# NexusHub Desktop Engine (public)

Public **Desktop Engine** source + release binaries for security review.

The full NexusHub web app lives in a **private** repo. This repository only publishes:

- `engine-main.js` — local loopback proxy (`127.0.0.1:8787`)
- `engine-security.js` — session token + SSRF checks
- `engine-remux.js` — fixed FFmpeg remux templates
- `engine-tray.ps1` — optional Windows tray helper
- Release `.zip` / `.exe` + SHA-256 + SBOM

See [ENGINE-SECURITY.md](./ENGINE-SECURITY.md) and [ENGINE-VERIFY.md](./ENGINE-VERIFY.md).

Download the latest Windows build from [Releases](https://github.com/R1GAS/nexushub-engine/releases).
