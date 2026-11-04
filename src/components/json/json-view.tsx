"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type Tok = { t: "key" | "str" | "num" | "lit" | "punct" | "ws"; v: string };

/** Tokenize pretty-printed JSON; rendered as text nodes (never as HTML) so payloads cannot inject markup. */
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])|(\s+)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: "punct", v: src.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({ t: m[2] ? "key" : "str", v: m[1] });
      if (m[2]) out.push({ t: "punct", v: m[2] });
    } else if (m[3] !== undefined) out.push({ t: "num", v: m[3] });
    else if (m[4] !== undefined) out.push({ t: "lit", v: m[4] });
    else if (m[5] !== undefined) out.push({ t: "punct", v: m[5] });
    else out.push({ t: "ws", v: m[6]! });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ t: "punct", v: src.slice(last) });
  return out;
}

const COLOR: Record<Tok["t"], string> = {
  key: "text-sky-600 dark:text-sky-300",
  str: "text-emerald-700 dark:text-emerald-300",
  num: "text-amber-700 dark:text-amber-300",
  lit: "text-violet-700 dark:text-violet-300",
  punct: "text-muted-foreground",
  ws: "",
};

export function JsonView({ value, className, maxHeight = "28rem", label }: { value: unknown; className?: string; maxHeight?: string; label?: string }) {
  const text = useMemo(() => JSON.stringify(value, null, 2) ?? "undefined", [value]);
  const toks = useMemo(() => tokenize(text), [text]);
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("relative rounded-md border bg-muted/40", className)}>
      <button
        type="button"
        aria-label={`Copy ${label ?? "JSON"}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable (insecure context / permissions): ignore */
          }
        }}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded border bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre tabIndex={0} className="overflow-auto p-3 font-mono text-xs leading-relaxed" style={{ maxHeight }}>
        <code>
          {toks.map((k, i) => (
            <span key={i} className={COLOR[k.t]}>
              {k.v}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
