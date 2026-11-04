import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIDELITY } from "@/lib/fidelity";

const matrix = readFileSync("docs/UCP_CAPABILITY_MATRIX.md", "utf8");
const text = (id: string) => FIDELITY.find((s) => s.id === id)!.items.join("\n");

describe("the spec-fidelity panel stays honest", () => {
  it("has the four sections", () => expect(FIDELITY.map((s) => s.id)).toEqual(["real", "simulated", "not_implemented", "deviations"]));
  it("never claims conformance, AP2, or other transports", () => {
    expect(text("not_implemented")).toMatch(/AP2/);
    expect(text("not_implemented")).toMatch(/MCP/);
    expect(text("not_implemented")).toMatch(/Identity linking/);
    expect(text("not_implemented")).toMatch(/no conformance claim/i);
    expect(text("real") + text("simulated")).not.toMatch(/\bconformant\b|\bcertified\b/i);
  });
  it("labels the agent, tokenizer and PSP as simulated and says no money moves", () => {
    expect(text("simulated")).toMatch(/agent/);
    expect(text("simulated")).toMatch(/credential provider.*PSP/);
    expect(text("simulated")).toMatch(/no money moves/);
  });
  it("every non-implemented item and deviation is also in the capability matrix document", () => {
    for (const w of ["AP2", "MCP", "Identity linking", "authority binding", "TLS"]) expect(matrix.toLowerCase(), w).toContain(w.toLowerCase());
  });
  it("states the demo deviation on authority binding precisely", () => expect(text("deviations")).toMatch(/relaxed.*localhost.*vercel\.app/));
});
