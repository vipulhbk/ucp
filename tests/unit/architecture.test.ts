import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDGES, PARTICIPANTS, TOUR, edgeById, participantById } from "@/lib/architecture";
import { OPERATIONS } from "@/platform/ucp-client";

/** `/api/ucp/v1/checkout-sessions/{id}/complete` → src/app/api/ucp/v1/checkout-sessions/[id]/complete/route.ts */
const routeFile = (endpoint: string) => `src/app${endpoint.replace(/\{(\w+)\}/g, "[$1]")}/route.ts`;
const allEndpoints = [...new Set([...PARTICIPANTS.flatMap((p) => p.endpoints), ...EDGES.flatMap((e) => e.endpoints)])];

describe("architecture data is consistent", () => {
  it("has the six participants the brief names, with unique ids", () => {
    expect(PARTICIPANTS.map((p) => p.id).sort()).toEqual(["agent", "cp", "merchant", "orders", "psp", "shopper"]);
    expect(new Set(PARTICIPANTS.map((p) => p.id)).size).toBe(PARTICIPANTS.length);
  });
  it("every edge connects two real participants and has a unique id", () => {
    for (const e of EDGES) {
      expect(participantById(e.from), `${e.id}.from`).toBeDefined();
      expect(participantById(e.to), `${e.id}.to`).toBeDefined();
      expect(e.description.length).toBeGreaterThan(40);
    }
    expect(new Set(EDGES.map((e) => e.id)).size).toBe(EDGES.length);
  });
  it("every participant is on at least one edge (no orphan boxes)", () => {
    for (const p of PARTICIPANTS) expect(EDGES.some((e) => e.from === p.id || e.to === p.id), p.id).toBe(true);
  });
  it("the guided tour only references real participants and edges, and each active edge touches an active node", () => {
    for (const s of TOUR) {
      expect(s.nodes.length, s.id).toBeGreaterThan(0);
      for (const n of s.nodes) expect(participantById(n), `${s.id} node ${n}`).toBeDefined();
      for (const eid of s.edges) {
        const e = edgeById(eid)!;
        expect(e, `${s.id} edge ${eid}`).toBeDefined();
        expect(s.nodes.some((n) => n === e.from || n === e.to), `${s.id}: edge ${eid} touches an active node`).toBe(true);
      }
      expect(s.tryIt.href.startsWith("/")).toBe(true);
    }
  });
  it("the tour covers every edge at least once", () => {
    const used = new Set(TOUR.flatMap((s) => s.edges));
    for (const e of EDGES) expect(used.has(e.id), e.id).toBe(true);
  });
  it("the tour is the purchase lifecycle in the order the protocol runs it", () => {
    expect(TOUR.map((s) => s.id)).toEqual(["discover", "negotiate", "intent", "search", "create", "update", "review", "authorize", "tokenize", "complete", "order", "webhook"]);
  });
});

describe("claims match the code", () => {
  it.each(allEndpoints.map((e) => [e]))("the endpoint %s is a real route", (endpoint) => {
    if (endpoint === "/api/platform/webhooks/orders/{platformId}" || endpoint.startsWith("/")) expect(existsSync(routeFile(endpoint)), routeFile(endpoint)).toBe(true);
  });
  it("every page link points at an existing page", () => {
    const hrefs = [...PARTICIPANTS.flatMap((p) => p.pages.map((x) => x.href)), ...TOUR.map((s) => s.tryIt.href)].map((h) => h.split("?")[0]!);
    for (const h of new Set(hrefs)) expect(existsSync(`src/app/(dashboard)${h}/page.tsx`), h).toBe(true);
  });
  it("scenario links name real scenarios", () => {
    const src = readFileSync("src/app-services/scenarios/definitions.ts", "utf8");
    for (const s of TOUR) {
      const id = new URLSearchParams(s.tryIt.href.split("?")[1] ?? "").get("s");
      if (id) expect(src, id).toContain(`id: "${id}"`);
    }
  });
  it("UCP operations named on edges are ones the platform client actually performs", () => {
    const known = new Set([...Object.keys(OPERATIONS), "get_profile", "tokenize", "order_event_webhook"]);
    for (const e of EDGES) for (const op of e.ops) expect(known.has(op), `${e.id}: ${op}`).toBe(true);
  });
  it("code paths named for participants exist", () => {
    for (const p of PARTICIPANTS) for (const c of p.code) expect(existsSync(c), `${p.id}: ${c}`).toBe(true);
  });
  it("participants are honestly labelled: the credential provider, PSP and agent are simulated; the business and orders are real", () => {
    const kind = Object.fromEntries(PARTICIPANTS.map((p) => [p.id, p.kind]));
    expect(kind).toEqual({ shopper: "human", agent: "simulated", merchant: "real", orders: "real", cp: "simulated", psp: "simulated" });
    for (const p of PARTICIPANTS.filter((x) => x.kind === "simulated")) expect(p.honesty, p.id).toMatch(/SIMULATED|simulation|simulated/i);
  });
  it("the shopper's honesty note says AP2 is not implemented", () => expect(participantById("shopper")!.honesty).toMatch(/AP2.*NOT implemented/));
  it("diagram positions fit the viewBox and nodes do not overlap", () => {
    for (const p of PARTICIPANTS) {
      expect(p.x).toBeGreaterThan(70);
      expect(p.x).toBeLessThan(930);
      expect(p.y).toBeGreaterThan(40);
      expect(p.y).toBeLessThan(480);
    }
    for (const a of PARTICIPANTS) for (const b of PARTICIPANTS) if (a.id < b.id) expect(Math.abs(a.x - b.x) >= 170 || Math.abs(a.y - b.y) >= 100, `${a.id}/${b.id}`).toBe(true);
  });
});
