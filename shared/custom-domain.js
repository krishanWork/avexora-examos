// Canonical custom-domain handling, shared by the browser bundle (src/) and the
// Node server (server/). Keep this dependency-free so it runs in both worlds.
//
// Single source of truth for domain normalization / validation. Every layer
// (storage, DNS verification, lookup, activation, uniqueness, live probing) must
// use `normalizeHost` so the canonical form never diverges across the stack.

const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const validHostname = (h) => typeof h === "string" && HOSTNAME_RE.test(h);

// Canonical form used for storage, comparison, lookup and uniqueness.
//   EXAM.SCHOOL.EDU        -> exam.school.edu
//   exam.school.edu.       -> exam.school.edu   (trailing DNS dot removed)
//   https://exam.school.edu-> exam.school.edu
//   https://exam.school.edu/ -> exam.school.edu
// Paths, query strings, fragments, ports, scheme leftovers and wildcards are
// REJECTED (returns null) rather than silently dropped.
export const normalizeHost = (raw) => {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.toLowerCase();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/^\/+/, "");
  s = s.replace(/[/.]+$/, "");
  if (!s) return null;
  if (/[/?#\s]/.test(s)) return null;
  if (s.includes(":")) return null;
  if (s.startsWith("*.")) return null;
  if (!validHostname(s)) return null;
  return s;
};

// Rough shape of the hostname relative to the platform: platform-owned host,
// a subdomain of the platform's own domain (portal address), an apex domain, or
// a subdomain. Used to decide how strictly DNS must be validated.
export const classifyHost = (host, { platformDomains = [], platformDomain = "" } = {}) => {
  if (typeof host !== "string" || !host) return "unknown";
  if (platformDomains.includes(host)) return "platform";
  if (platformDomain && host.endsWith(`.${platformDomain}`)) return "portal-subdomain";
  const labels = host.split(".");
  return labels.length <= 2 ? "apex" : "subdomain";
};

// True when an IP must never be dialed from the server (RFC1918, link-local,
// loopback, IPv6 equivalents, CGNAT). DNS-rebinding / localhost exfiltration
// guards rely on this.
export const isPrivateIp = (ip) => {
  if (typeof ip !== "string" || !ip) return false;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower === "0:0:0:0:0:0:0:0" || lower === "0:0:0:0:0:0:0:1") return true;
    const first = lower.split(":")[0];
    if (/^fe[89ab]/.test(first)) return true; // fe80::/10 (fe80-febf)
    if (/^f[cd]/.test(first)) return true; // fc00::/7 (fc00-fdff)
    const v4 = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return isPrivateIp(v4[1]);
    return false;
  }
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
};