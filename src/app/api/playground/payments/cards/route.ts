import { TEST_CARDS } from "@/sim/psp";

/** The published test cards and their deterministic outcomes. These are test values, not real card numbers. */
export async function GET() {
  return Response.json({ simulated: true, cards: TEST_CARDS.map(({ id, number, brand, outcome, label }) => ({ id, number, brand, outcome, label })) });
}
