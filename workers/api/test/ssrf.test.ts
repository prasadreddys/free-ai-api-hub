// FREE AI API HUB — SSRF guard tests.
// classifyIp returns a reason string when blocked, null when public.
// DNS is mocked (a resolver object returning fixed IPs), so no real network.

import { describe, expect, it, vi } from "vitest";
import { classifyIp, cloudflareDohResolver, validateProviderUrl, type DnsResolver } from "../src/lib/ssrf";
import { dohResponse } from "./setup";

function resolver(ips: string[]): DnsResolver {
  return { resolve: async (_hostname: string) => ips };
}

describe("classifyIp", () => {
  it("returns null for public IPv4 and IPv6", () => {
    expect(classifyIp("93.184.216.34")).toBeNull();
    expect(classifyIp("8.8.8.8")).toBeNull();
    expect(classifyIp("2606:4700:4700::1111")).toBeNull();
  });

  it("blocks loopback, private, link-local and CGNAT ranges", () => {
    expect(classifyIp("127.0.0.1")).toMatch(/loopback/);
    expect(classifyIp("::1")).toMatch(/loopback/);
    expect(classifyIp("10.0.0.5")).toMatch(/private/);
    expect(classifyIp("192.168.1.1")).toMatch(/private/);
    expect(classifyIp("172.16.0.1")).toMatch(/private/);
    expect(classifyIp("169.254.169.254")).toMatch(/link-local/);
    expect(classifyIp("100.64.0.1")).toMatch(/CGNAT/);
  });

  it("blocks cloud metadata addresses", () => {
    expect(classifyIp("169.254.169.254")).not.toBeNull();
    expect(classifyIp("100.100.100.200")).not.toBeNull();
    expect(classifyIp("fd00:ec2::254")).not.toBeNull();
  });

  it("classifies IPv4-mapped IPv6 by the embedded address", () => {
    expect(classifyIp("::ffff:10.0.0.1")).toMatch(/private/);
    expect(classifyIp("::ffff:8.8.8.8")).toBeNull();
  });

  it("returns null for unparseable input (not an IP literal)", () => {
    expect(classifyIp("not-an-ip")).toBeNull();
  });
});

describe("validateProviderUrl", () => {
  it("accepts a public https URL", async () => {
    const res = await validateProviderUrl("https://api.example.com/v1", {
      resolver: resolver(["93.184.216.34"]),
    });
    expect(res.ok).toBe(true);
    expect(res.resolvedIps).toEqual(["93.184.216.34"]);
  });

  it("rejects http (https only)", async () => {
    const res = await validateProviderUrl("http://api.example.com/v1", {
      resolver: resolver(["93.184.216.34"]),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/https/i);
  });

  it("rejects a literal private IP in the URL", async () => {
    const res = await validateProviderUrl("https://10.0.0.5/v1");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/private/i);
  });

  it("rejects a literal metadata IP in the URL", async () => {
    const res = await validateProviderUrl("https://169.254.169.254/v1");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/link-local/i);
  });

  it("rejects a hostname that resolves to a private IP", async () => {
    const res = await validateProviderUrl("https://internal.example.com/v1", {
      resolver: resolver(["10.0.0.5"]),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/10\.0\.0\.5/);
  });

  it("rejects a hostname that resolves to a metadata address", async () => {
    const res = await validateProviderUrl("https://metadata.example.com/v1", {
      resolver: resolver(["169.254.169.254"]),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects cloud metadata hostnames outright", async () => {
    const res = await validateProviderUrl("https://metadata.google.internal/v1", {
      resolver: resolver(["93.184.216.34"]),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/metadata/i);
  });

  it("rejects URLs with embedded credentials", async () => {
    const withCreds = await validateProviderUrl("https://user:pass@api.example.com/v1", {
      resolver: resolver(["93.184.216.34"]),
    });
    expect(withCreds.ok).toBe(false);
    expect(withCreds.reason).toMatch(/credentials/i);
  });

  // Note: the guard does not restrict ports (a non-standard port is
  // accepted). Internal services are still blocked by the DNS/IP checks.

  it("fails closed when DNS returns no records", async () => {
    const res = await validateProviderUrl("https://api.example.com/v1", {
      resolver: resolver([]),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no DNS records/i);
  });

  it("uses the Cloudflare DoH resolver (mocked fetch)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("cloudflare-dns.com");
      return dohResponse(["93.184.216.34"]);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const resolver = cloudflareDohResolver();
      const ips = await resolver.resolve("api.example.com");
      expect(ips).toEqual(["93.184.216.34", "93.184.216.34"]); // A + AAAA both mocked
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // And validateProviderUrl accepts the URL when given that resolver.
      const res = await validateProviderUrl("https://api.example.com/v1", { resolver });
      expect(res.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
