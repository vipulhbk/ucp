import http from "node:http";
import type { AddressInfo } from "node:net";

export type Handler = (req: Request, params: Record<string, string>) => Promise<Response> | Response;

function compile(pattern: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_m, n: string) => (names.push(n), "([^/]+)")) + "$");
  return { re, names };
}

/** Serve Next-style route handlers over a real local HTTP socket (the platform fetches over real HTTP). Supports `:param` segments. */
export async function serve(routes: Record<string, Handler>): Promise<{ origin: string; close: () => Promise<void> }> {
  const compiled = Object.entries(routes).map(([p, h]) => ({ ...compile(p), h }));
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    const path = (req.url ?? "/").split("?")[0]!;
    let params: Record<string, string> = {};
    const hit = compiled.find((c) => {
      const m = c.re.exec(path);
      if (!m) return false;
      params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
      return true;
    });
    if (!hit) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(origin + req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
    });
    const response = await hit.h(request, params);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
