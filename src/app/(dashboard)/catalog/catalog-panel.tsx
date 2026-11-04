"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Search, Star } from "lucide-react";
import { ExchangePanel } from "@/components/exchange/exchange-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BffError, ucp, type CallResult } from "@/lib/api";
import { rupees } from "@/lib/format";

interface Product {
  id: string;
  title: string;
  description: { plain?: string };
  price_range: { min: { amount: number } };
  media?: { url: string }[];
  rating?: { value: number; count?: number };
  tags?: string[];
  variants: { id: string; availability?: { available?: boolean; status?: string } }[];
}

export function CatalogPanel() {
  const [query, setQuery] = useState("wireless headphone with noise cancellation");
  const [max, setMax] = useState("5000");
  const [result, setResult] = useState<CallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const maxPaise = Math.round(Number(max) * 100);
      setResult(await ucp("search_catalog", { body: { query, ...(Number.isFinite(maxPaise) && maxPaise > 0 ? { filters: { price: { max: maxPaise } } } : {}), pagination: { limit: 12 } } }));
    } catch (e) {
      setError(e instanceof BffError ? e.info.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const products: Product[] = result?.body?.products ?? [];
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="min-w-64 flex-1 text-sm">
          <span className="mb-1 block text-muted-foreground">Search</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. wireless headphone with noise cancellation" />
        </label>
        <label className="w-36 text-sm">
          <span className="mb-1 block text-muted-foreground">Max price (₹)</span>
          <Input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <Button type="submit" disabled={busy} data-testid="search">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
        </Button>
      </form>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      {!result && !error && <p className="text-sm text-muted-foreground">Run a search to see products and the exact request and response behind them.</p>}

      {result && (
        <>
          <p className="text-sm text-muted-foreground" data-testid="count">
            {products.length} of {result.body?.pagination?.total_count ?? products.length} products
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => {
              const v = p.variants[0]!;
              const available = v.availability?.available !== false;
              return (
                <Card key={p.id} id={p.id} data-testid="product">
                  <CardContent className="flex gap-3 pt-6">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVG placeholder */}
                    <img src={p.media?.[0]?.url} alt="" width={64} height={64} className="size-16 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-medium leading-tight">{p.title}</div>
                      <div className="font-mono text-sm">{rupees(p.price_range.min.amount)}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {p.rating && (
                          <span className="inline-flex items-center gap-0.5">
                            <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden /> {p.rating.value} ({p.rating.count})
                          </span>
                        )}
                        <Badge variant={available ? "secondary" : "destructive"}>{available ? "in stock" : "out of stock"}</Badge>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{p.description.plain}</p>
                      {available ? (
                        <Link href={`/checkout?add=${encodeURIComponent(v.id)}`} className="inline-block pt-1 text-xs font-medium text-primary hover:underline">
                          Start checkout →
                        </Link>
                      ) : (
                        <Link href={`/checkout?add=${encodeURIComponent(v.id)}`} className="inline-block pt-1 text-xs text-muted-foreground hover:underline">
                          Try anyway (see the out_of_stock error) →
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <ExchangePanel exchange={result.exchange} title="Search exchange" />
        </>
      )}
    </div>
  );
}
