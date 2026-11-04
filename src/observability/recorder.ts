import type { Store } from "@/persistence/store";
import { redactBody, redactHeaders } from "./redact";

export type Actor = "platform" | "business" | "psp" | "credential_provider" | "system";

export interface ValidationEntry {
  target: "request" | "response" | "profile";
  schema: string;
  ok: boolean;
  issues: { path: string; message: string }[];
}

/**
 * A recorded protocol exchange. It deliberately has NO session id: the demo session id is the HttpOnly cookie secret and
 * these records are shown in the browser and exported. The storage key already scopes them to the session.
 */
export interface InteractionRecord {
  id: string;
  correlationId: string;
  ts: string;
  actor: Actor;
  /** UCP operation name where one applies (e.g. create_checkout, get_profile) */
  op: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  durationMs?: number;
  validation: ValidationEntry[];
  error?: { kind: string; message: string };
  /** Free-form note shown in the inspector, e.g. "non-normative error code". */
  note?: string;
  /** Whether the request is safe to replay from the inspector. */
  replayable?: boolean;
}

const LOG_MAX = 2000;
export const logKey = (sid: string) => `s:${sid}:log`;
export const merchantLogKey = (platformId: string) => `m:${platformId}:log`;

/** What callers hand to `record`: the record plus the id that selects the storage namespace (never persisted or returned). */
export type InteractionInput = InteractionRecord & { sid: string };

export class Recorder {
  /** `keyFor` lets the business side keep its own log under its own namespace (platform and business share no keys). */
  constructor(
    private store: Store,
    private keyFor: (id: string) => string = logKey,
  ) {}

  /** Redacts, then persists. Never throws: logging must not break a protocol call. Returns the redacted record. */
  async record(input: InteractionInput): Promise<InteractionRecord> {
    const { sid, ...rec } = input;
    const safe: InteractionRecord = {
      ...rec,
      requestHeaders: redactHeaders(rec.requestHeaders),
      requestBody: rec.requestBody === undefined ? undefined : redactBody(rec.requestBody),
      responseHeaders: rec.responseHeaders ? redactHeaders(rec.responseHeaders) : undefined,
      responseBody: rec.responseBody === undefined ? undefined : redactBody(rec.responseBody),
    };
    try {
      await this.store.listPush(this.keyFor(sid), safe, { max: LOG_MAX });
    } catch (e) {
      console.error("[recorder] failed to persist interaction", (e as Error).message);
    }
    return safe;
  }

  async list(sid: string): Promise<InteractionRecord[]> {
    return this.store.listRange<InteractionRecord>(this.keyFor(sid));
  }
}
