// FREE AI API HUB — SSRF guard for custom provider URLs.
// Mirrors the reference's url-guard behavior, rewritten for Workers:
// allow https only by default; block loopback, private, link-local, CGNAT,
// and cloud metadata addresses (including IPv6/embedded forms); resolve the
// hostname (DNS-over-HTTPS) and classify every returned IP; re-validate at
// request time because DNS can change between save and use.
// Original code for this project.

import { ApiError } from "./errors";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".metadata.google.internal"];

/** Classify an IPv4/IPv6 literal. Returns "blocked" with a reason, or null. */
export function classifyIp(ip: string): string | null {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.1) — classify the embedded v4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : lower;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    if (a === 10) return "private (10/8)";
    if (a === 127) return "loopback (127/8)";
    if (a === 169 && b === 254) return "link-local (169.254/16)";
    if (a === 172 && b >= 16 && b <= 31) return "private (172.16/12)";
    if (a === 192 && b === 168) return "private (192.168/16)";
    if (a === 100 && b >= 64 && b <= 127) return "CGNAT (100.64/10)";
    if (a === 0) return "unspecified (0.0.0.0/8)";
    if (a >= 224) return "multicast/reserved";
    return null;
  }
  // IPv6
  if (lower.includes(":")) {
    if (lower === "::1" || lower === "::") return "loopback/unspecified (::1/::)";
    if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return "link-local (fe80::/10)";
    if (lower.startsWith("fc") || lower.startsWith("fd")) return "private (fc00::/7)";
    if (lower.startsWith("ff")) return "multicast (ff00::/8)";
    if (lower === "100::" || lower.startsWith("100:")) return "discard (100::/64)";
    return null;
  }
  return null;
}

function hostnameBlocked(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return `blocked hostname: ${h}`;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return `blocked hostname suffix: ${h}`;
  const ipReason = classifyIp(h);
  if (ipReason) return `blocked IP literal: ${h} (${ipReason})`;
  return null;
}

export interface DnsResolver {
  /** Resolve A + AAAA records for a hostname. Returns the IP strings. */
  resolve(hostname: string): Promise<string[]>;
}

/** DNS-over-HTTPS resolver using Cloudflare's public resolver. */
export function cloudflareDohResolver(): DnsResolver {
  return {
    async resolve(hostname: string): Promise<string[]> {
      const ips: string[] = [];
      for (const type of ["A", "AAAA"]) {
        const res = await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
          { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          Answer?: { type: number; data: string }[];
        };
        for (const ans of json.Answer ?? []) {
          if (ans.type === 1 || ans.type === 28) ips.push(ans.data);
        }
      }
      return ips;
    },
  };
}

export interface UrlValidation {
  ok: boolean;
  reason?: string;
  resolvedIps?: string[];
}

/**
 * Validate a custom provider base URL.
 * - https only (http only when allowHttp is true — local dev only).
 * - No embedded credentials, no blocked hostname, no blocked IP literal.
 * - Resolve the hostname and classify every IP; any blocked IP fails closed.
 * - When `resolver` is omitted, only literal checks run (DNS step skipped).
 */
export async function validateProviderUrl(
  rawUrl: string,
  opts: { allowHttp?: boolean; resolver?: DnsResolver } = {},
): Promise<UrlValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: `only https URLs are allowed (got ${url.protocol})` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }
  const blocked = hostnameBlocked(url.hostname);
  if (blocked) return { ok: false, reason: blocked };
  if (opts.resolver) {
    let ips: string[];
    try {
      ips = await opts.resolver.resolve(url.hostname);
    } catch {
      return { ok: false, reason: `DNS resolution failed for ${url.hostname}` };
    }
    if (ips.length === 0) {
      return { ok: false, reason: `no DNS records for ${url.hostname}` };
    }
    for (const ip of ips) {
      const reason = classifyIp(ip);
      if (reason) {
        return { ok: false, reason: `${url.hostname} resolves to blocked IP ${ip} (${reason})` };
      }
    }
    return { ok: true, resolvedIps: ips };
  }
  return { ok: true };
}

/** Throw an ApiError when a custom provider URL fails validation. */
export async function assertSafeProviderUrl(
  rawUrl: string,
  opts: { allowHttp?: boolean; resolver?: DnsResolver } = {},
): Promise<void> {
  const result = await validateProviderUrl(rawUrl, opts);
  if (!result.ok) {
    throw new ApiError(400, "invalid_request_error", `Unsafe provider URL: ${result.reason}`);
  }
}
