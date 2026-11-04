import "server-only";
import { randomBytes } from "node:crypto";

const COOKIE = "demo_sid";
const SID_RE = /^[a-f0-9]{32}$/;

export interface SessionContext {
  sid: string;
  /** Set-Cookie header value when a new session was created, else undefined. */
  setCookie?: string;
}

/** Anonymous per-visitor demo session. 128-bit random id, HttpOnly, SameSite=Lax. Not an identity. */
export function sessionFrom(req: Request): SessionContext {
  const raw = req.headers.get("cookie") ?? "";
  const match = raw.split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  const existing = match?.slice(COOKIE.length + 1);
  if (existing && SID_RE.test(existing)) return { sid: existing };
  const sid = randomBytes(16).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return { sid, setCookie: `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}` };
}

export function withSessionCookie(res: Response, ctx: SessionContext): Response {
  if (ctx.setCookie) res.headers.append("Set-Cookie", ctx.setCookie);
  return res;
}
