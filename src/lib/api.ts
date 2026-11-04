import type { InteractionRecord, ValidationEntry } from "@/observability/recorder";

/** What the playground BFF returns for a UCP call. `exchange` is the redacted record; `body` is the raw response. */
export interface CallResult {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- protocol payloads are inspected, not typed, in the UI
  headers: Record<string, string>;
  requestId: string;
  idempotencyKey?: string;
  durationMs: number;
  validation: ValidationEntry[];
  exchange: InteractionRecord;
  attempts: number;
}

export interface ApiError {
  kind: string;
  message: string;
  code?: string;
  issues?: { path: string; message: string }[];
}

export class BffError extends Error {
  constructor(
    public info: ApiError,
    public status: number,
  ) {
    super(info.message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({ error: { kind: "bad_response", message: `HTTP ${res.status}` } }));
  if (!res.ok) throw new BffError((data as { error: ApiError }).error ?? { kind: "error", message: `HTTP ${res.status}` }, res.status);
  return data as T;
}

export const post = <T>(path: string, body?: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => json<T>(r));
export const get = <T>(path: string) => fetch(path).then((r) => json<T>(r));

export const ucp = (op: string, args: { id?: string; body?: unknown; skipValidation?: boolean; idempotencyKey?: string } = {}) => post<CallResult>("/api/playground/ucp/call", { op, ...args });
