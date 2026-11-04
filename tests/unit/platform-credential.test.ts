import { describe, expect, it } from "vitest";
import { issueApiKey, platformIdFor, verifyApiKey } from "@/ucp/platform-credential";

describe("platform API key", () => {
  const secret = "s3cret";
  const pid = platformIdFor("a".repeat(32));
  it("round-trips and scopes to the platform id", () => expect(verifyApiKey(secret, issueApiKey(secret, pid))).toBe(pid));
  it("is not derivable back to the session id", () => expect(pid).not.toContain("a".repeat(8)));
  it("rejects tampering, wrong secret, and malformed values", () => {
    const key = issueApiKey(secret, pid);
    expect(verifyApiKey("other", key)).toBeNull();
    expect(verifyApiKey(secret, key.slice(0, -2) + "xx")).toBeNull();
    expect(verifyApiKey(secret, key.replace(pid, platformIdFor("b".repeat(32))))).toBeNull();
    expect(verifyApiKey(secret, "plk_nope")).toBeNull();
    expect(verifyApiKey(secret, null)).toBeNull();
    expect(verifyApiKey(secret, "Bearer x")).toBeNull();
  });
});
