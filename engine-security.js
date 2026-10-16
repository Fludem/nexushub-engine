"use strict";

/**
 * Shared Engine proxy hardening (Phase 1):
 * session token helpers, SSRF / destination checks, size limits, safe logging.
 */
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { URL } = require("url");

const MAX_URL_LENGTH = Number(process.env.NEXUSHUB_MAX_URL_LENGTH || 8192);
const MAX_REDIRECTS = Number(process.env.NEXUSHUB_MAX_REDIRECTS || 5);
const MAX_BUFFER_BYTES = Number(process.env.NEXUSHUB_MAX_BUFFER_BYTES || 32 * 1024 * 1024);
const MAX_CONCURRENT_UPSTREAM = Number(process.env.NEXUSHUB_MAX_CONCURRENT || 8);

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function tokensEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Extract session token from query, Authorization Bearer, or X-NexusHub-Token. */
function readRequestToken(req, reqUrl) {
  const q = reqUrl && reqUrl.searchParams ? reqUrl.searchParams.get("token") : "";
  if (q) return String(q);
  const header = req && req.headers ? req.headers["x-nexushub-token"] : "";
  if (header) return String(header);
  const auth = req && req.headers ? String(req.headers.authorization || "") : "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : "";
}

function isBlockedIp(ip) {
  const raw = String(ip || "").trim().toLowerCase();
  if (!raw) return true;

  if (net.isIP(raw) === 4) {
    const p = raw.split(".").map((n) => Number(n));
    if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return true;
    if (p[0] === 0 || p[0] === 127) return true;
    if (p[0] === 10) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIP(raw) === 6) {
    if (raw === "::" || raw === "::1") return true;
    if (raw.startsWith("fc") || raw.startsWith("fd")) return true; // ULA
    if (raw.startsWith("fe80")) return true; // link-local
    if (raw.startsWith("ff")) return true; // multicast
    // IPv4-mapped :ffff:a.b.c.d
    const mapped = /(?::ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }

  return true;
}

function safeLogHost(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

/**
 * Allow only http(s). Resolve hostname and reject private / loopback / metadata IPs.
 * Call again on every redirect hop.
 */
async function assertSafeUpstreamUrl(rawUrl) {
  if (String(rawUrl || "").length > MAX_URL_LENGTH) {
    throw new Error("URL too long");
  }
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) upstream URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL userinfo not allowed");
  }

  const hostname = String(parsed.hostname || "").replace(/^\[|\]$/g, "");
  if (!hostname) throw new Error("Missing host");

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("Blocked destination address");
    return parsed;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("DNS lookup failed");
  }
  if (!records || !records.length) throw new Error("DNS lookup returned no addresses");
  for (const row of records) {
    if (isBlockedIp(row.address)) {
      throw new Error("Blocked destination address (DNS)");
    }
  }
  return parsed;
}

function createConcurrencyGate(limit = MAX_CONCURRENT_UPSTREAM) {
  let active = 0;
  const waiters = [];
  const acquire = () =>
    new Promise((resolve) => {
      if (active < limit) {
        active += 1;
        resolve();
        return;
      }
      waiters.push(resolve);
    });
  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) {
      active += 1;
      next();
    }
  };
  return { acquire, release, active: () => active };
}

module.exports = {
  MAX_URL_LENGTH,
  MAX_REDIRECTS,
  MAX_BUFFER_BYTES,
  MAX_CONCURRENT_UPSTREAM,
  generateSessionToken,
  tokensEqual,
  readRequestToken,
  isBlockedIp,
  safeLogHost,
  assertSafeUpstreamUrl,
  createConcurrencyGate,
};
