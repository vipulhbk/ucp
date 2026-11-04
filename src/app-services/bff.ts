import "server-only";
import { UcpClientError } from "@/platform/ucp-client";
import { ConsentError } from "@/platform/consent";
import { FlowError } from "./checkout-flow";
import { sessionFrom, withSessionCookie, type SessionContext } from "./session";

/** Wraps a playground route: session cookie, typed errors → JSON. */
export function bff(handler: (req: Request, ctx: SessionContext) => Promise<Response | unknown>) {
  return async (req: Request): Promise<Response> => {
    const ctx = sessionFrom(req);
    try {
      const out = await handler(req, ctx);
      const res = out instanceof Response ? out : Response.json(out);
      return withSessionCookie(res, ctx);
    } catch (e) {
      if (e instanceof UcpClientError) return withSessionCookie(Response.json({ error: { kind: e.kind, message: e.message, issues: e.issues } }, { status: e.kind === "validation" ? 422 : 502 }), ctx);
      if (e instanceof FlowError) return withSessionCookie(Response.json({ error: { kind: e.kind, message: e.message }, ...e.extra }, { status: e.status }), ctx);
      if (e instanceof ConsentError) return withSessionCookie(Response.json({ error: { kind: "consent", code: e.code, message: e.message } }, { status: 403 }), ctx);
      console.error("[bff]", e);
      return withSessionCookie(Response.json({ error: { kind: "internal", message: "Unexpected error" } }, { status: 500 }), ctx);
    }
  };
}

export const badRequest = (message: string) => Response.json({ error: { kind: "bad_request", message } }, { status: 400 });
