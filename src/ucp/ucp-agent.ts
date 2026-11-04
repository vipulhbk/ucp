import { parseDictionary, serializeDictionary } from "structured-headers";

/** `UCP-Agent: profile="https://…"` — an RFC 8941 Dictionary Structured Field (overview → Platform Advertisement). */
export type UcpAgentParse = { ok: true; profile: string } | { ok: false; reason: string };

export function parseUcpAgent(header: string | null | undefined): UcpAgentParse {
  if (!header) return { ok: false, reason: "UCP-Agent header is missing" };
  let dict;
  try {
    dict = parseDictionary(header);
  } catch (e) {
    return { ok: false, reason: `UCP-Agent is not a valid RFC 8941 dictionary: ${(e as Error).message}` };
  }
  const member = dict.get("profile");
  if (!member) return { ok: false, reason: 'UCP-Agent has no "profile" member' };
  const value = Array.isArray(member) ? member[0] : member;
  if (typeof value !== "string") return { ok: false, reason: '"profile" must be a quoted string' };
  return { ok: true, profile: value };
}

export function serializeUcpAgent(profileUrl: string): string {
  return serializeDictionary(new Map([["profile", [profileUrl, new Map()]]]));
}
