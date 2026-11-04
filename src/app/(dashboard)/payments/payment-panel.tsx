"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BffError, get, post } from "@/lib/api";
import type { InteractionRecord } from "@/observability/recorder";

interface Card_ {
  id: string;
  number: string;
  brand: string;
  outcome: string;
  label: string;
}
interface Info {
  variant: string;
  ok: boolean;
  paymentHandlers: { name: string; id: string; instruments: string[]; simulated: boolean }[];
}
interface TokenizeResult {
  status: number;
  body: { token?: string; error?: string; message?: string; expires_at?: string; display?: { brand: string; last4: string } };
  exchange: InteractionRecord;
}

const OUTCOME_TONE: Record<string, string> = { approved: "secondary", declined: "destructive", insufficient_funds: "destructive", async: "outline" };

export function PaymentPanel() {
  const [cards, setCards] = useState<Card_[]>([]);
  const [info, setInfo] = useState<Info | null>(null);
  const [result, setResult] = useState<TokenizeResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<{ cards: Card_[] }>("/api/playground/payments/cards").then((r) => setCards(r.cards));
    void get<Info>("/api/playground/session/info").then(setInfo).catch((e) => setError(e instanceof BffError ? e.info.message : String(e)));
  }, []);

  async function tokenize(body: { cardId?: string; number?: string }, label: string) {
    setBusy(label);
    setError(null);
    try {
      setResult(await post<TokenizeResult>("/api/playground/payments/tokenize", body));
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Handler discovery</CardTitle>
          <CardDescription>The handler comes from the business profile (and every checkout response). Nothing is hardcoded in the platform.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {!info && !error && <Loader2 className="size-4 animate-spin" aria-label="Loading" />}
          {info?.paymentHandlers.length === 0 && <p className="text-muted-foreground">The business advertises no payment handler.</p>}
          {info?.paymentHandlers.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {h.name}
              <span className="text-muted-foreground">id={h.id} · instruments: {h.instruments.join(", ")}</span>
              {h.simulated && <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">simulated</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Tokenize a test card</CardTitle>
          <CardDescription>Platform → credential provider: <code className="font-mono">POST /tokenize</code> with the card and a <code className="font-mono">binding</code> to the checkout (a replay guard). The result is a token, never the card.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Test card (published test value)</th>
                  <th className="pr-3">Deterministic outcome</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs">{c.number.replace(/(.{4})/g, "$1 ").trim()}</div>
                      <div className="text-xs text-muted-foreground">{c.label}</div>
                    </td>
                    <td className="pr-3">
                      <Badge variant={(OUTCOME_TONE[c.outcome] ?? "outline") as "secondary"}>{c.outcome.replace("_", " ")}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => tokenize({ cardId: c.id }, c.id)} data-testid={`tokenize-${c.id}`}>
                        {busy === c.id && <Loader2 className="size-3 animate-spin" />} Tokenize
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The charge outcome happens later, when a checkout is completed with the token (Checkout Playground). Tokenizing never charges.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            3 · Try a real card number <AlertTriangle className="size-4 text-amber-500" aria-hidden />
          </CardTitle>
          <CardDescription>
            Do not enter a real card. This box exists to show the refusal: anything that is not a published test card is rejected, never stored, never logged, and never echoed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <Input className="max-w-xs font-mono" inputMode="numeric" autoComplete="off" maxLength={23} placeholder="any number — it will be refused" value={typed} onChange={(e) => setTyped(e.target.value.replace(/[^\d ]/g, ""))} aria-label="Card number to refuse" />
          <Button variant="outline" disabled={!typed || busy !== null} onClick={() => tokenize({ number: typed }, "typed")} data-testid="tokenize-typed">
            Submit to the simulator
          </Button>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      {result && (
        <div className="space-y-2" data-testid="token-result">
          <div className="text-sm">
            {result.status === 200 ? (
              <span>Token issued for {result.body.display?.brand} ···· {result.body.display?.last4}. Value redacted here and in the log.</span>
            ) : (
              <span className="text-destructive">
                Refused ({result.status} {result.body.error}): {result.body.message}
              </span>
            )}
          </div>
          <ExchangePanel exchange={result.exchange} title="Tokenize exchange" />
        </div>
      )}
    </div>
  );
}
