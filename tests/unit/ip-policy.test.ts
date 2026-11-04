import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "@/ucp/ip-policy";

describe("SSRF address policy", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1", "203.0.113.5"])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34"])("allows public %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
  it.each(["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1"])("blocks IPv6 %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
  it("allows public IPv6 and public IPv4-mapped", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });
  it("refuses anything that is not an IP", () => expect(isBlockedAddress("example.com")).toBe(true));
});
