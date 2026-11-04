import { randomUUID } from "node:crypto";
import type { InteractionRecord, Recorder } from "@/observability/recorder";
import { safeFetch, SafeFetchError, type SafeFetchOptions } from "@/ucp/safe-fetch";
import { TEST_CARDS } from "@/sim/psp";

export interface TokenizeOutcome {
  ok: boolean;
  status: number;
  token?: string;
  body: unknown;
  exchange: InteractionRecord;
}

/**
 * Platform → credential provider (SIMULATED): the handler's tokenize step. The URL comes from the handler `config`
 * the business advertised, and is fetched through the same SSRF-safe, allowlisted fetcher as everything else.
 * The platform holds only published test card numbers here.
 */
export async function tokenizeViaHandler(args: {
  sid: string;
  recorder: Recorder;
  tokenizeUrl: string;
  apiKey: string;
  fetchOptions: Pick<SafeFetchOptions, "allowedOrigins" | "devLoopbackHosts">;
  /** One of the published test cards, or a raw number typed into the simulator (to demonstrate refusal). */
  card: { id: string } | { number: string };
  binding: { type: string; id: string };
}): Promise<TokenizeOutcome> {
  const number = "id" in args.card ? TEST_CARDS.find((c) => c.id === (args.card as { id: string }).id)?.number : (args.card as { number: string }).number;
  const requestBody = { credential: { type: "pan", number, expiry_month: 12, expiry_year: 2030, name: "Test Buyer" }, binding: args.binding };
  const headers = { "content-type": "application/json", "x-api-key": args.apiKey, "request-id": randomUUID() };
  const started = new Date().toISOString();
  const t0 = Date.now();
  try {
    const res = await safeFetch(args.tokenizeUrl, { ...args.fetchOptions, method: "POST", headers, body: JSON.stringify(requestBody) });
    const body = JSON.parse(res.bodyText) as { token?: string };
    const exchange = await args.recorder.record({
      id: randomUUID(), sid: args.sid, correlationId: headers["request-id"], ts: started, actor: "credential_provider", op: "tokenize", method: "POST", url: args.tokenizeUrl,
      requestHeaders: headers, requestBody, status: res.status, responseHeaders: res.headers, responseBody: body, durationMs: Date.now() - t0, validation: [],
      note: "SIMULATED credential provider. Only published test cards are accepted; the card number is redacted in logs.",
    });
    return { ok: res.status === 200 && typeof body.token === "string", status: res.status, token: body.token, body, exchange };
  } catch (e) {
    const err = e as SafeFetchError;
    const exchange = await args.recorder.record({
      id: randomUUID(), sid: args.sid, correlationId: headers["request-id"], ts: started, actor: "credential_provider", op: "tokenize", method: "POST", url: args.tokenizeUrl,
      requestHeaders: headers, requestBody, validation: [], error: { kind: err.code ?? "error", message: err.message },
    });
    return { ok: false, status: 0, body: { error: err.code, message: err.message }, exchange };
  }
}
