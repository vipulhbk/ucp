"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { JsonView } from "@/components/json/json-view";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { InteractionRecord } from "@/observability/recorder";

const STATUS_TONE = (s?: number) => (!s ? "text-destructive" : s < 300 ? "text-emerald-600 dark:text-emerald-400" : s < 500 ? "text-amber-600 dark:text-amber-400" : "text-destructive");

/** One real request/response pair: exactly what crossed the wire, redacted. */
export function ExchangePanel({ exchange, title }: { exchange: InteractionRecord; title?: string }) {
  const { method, url, status, durationMs, validation, error, note, actor, op } = exchange;
  return (
    <div className="rounded-md border" data-testid="exchange">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
        {title && <span className="font-medium">{title}</span>}
        <Badge variant="outline" className="font-mono">{actor}</Badge>
        <span className="font-mono">{op}</span>
        <span className="font-mono"><strong>{method}</strong> {url.replace(/^https?:\/\/[^/]+/, "")}</span>
        <span className={`font-mono ${STATUS_TONE(status)}`}>{status ?? "no response"}</span>
        {durationMs !== undefined && <span className="text-muted-foreground">{durationMs} ms</span>}
        {validation.map((v, i) => (
          <span key={i} title={v.issues.map((x) => `${x.path}: ${x.message}`).join("\n") || v.schema} className="inline-flex items-center gap-1 text-muted-foreground">
            {v.ok ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden /> : <XCircle className="size-3.5 text-destructive" aria-hidden />}
            {v.target} schema {v.ok ? "ok" : "FAILED"}
          </span>
        ))}
      </div>
      {error && <div className="border-b bg-destructive/10 px-3 py-1.5 text-xs">{error.kind}: {error.message}</div>}
      {note && <div className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">{note}</div>}
      <Tabs defaultValue="response" className="p-3">
        <TabsList>
          <TabsTrigger value="request">Request</TabsTrigger>
          <TabsTrigger value="response">Response</TabsTrigger>
        </TabsList>
        <TabsContent value="request" className="space-y-2 pt-2">
          <JsonView value={exchange.requestHeaders} label="request headers" maxHeight="10rem" />
          {exchange.requestBody !== undefined && <JsonView value={exchange.requestBody} label="request body" maxHeight="20rem" />}
        </TabsContent>
        <TabsContent value="response" className="space-y-2 pt-2">
          {exchange.responseHeaders && <JsonView value={exchange.responseHeaders} label="response headers" maxHeight="10rem" />}
          {exchange.responseBody !== undefined && <JsonView value={exchange.responseBody} label="response body" maxHeight="24rem" />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
