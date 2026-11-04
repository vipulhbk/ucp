"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, Square, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EDGES, PARTICIPANTS, TOUR, edgeById, participantById, type Edge, type Kind, type Participant } from "@/lib/architecture";
import { cn } from "@/lib/utils";

const W = 170;
const H = 72;
type Sel = { type: "node"; id: string } | { type: "edge"; id: string } | null;

const KIND_LABEL: Record<Kind, string> = { human: "you", real: "real protocol behavior", simulated: "simulated" };
const KIND_STYLE: Record<Kind, string> = {
  human: "border-muted-foreground/50 bg-muted/60",
  real: "border-emerald-500/70 bg-emerald-500/10",
  simulated: "border-amber-500/70 border-dashed bg-amber-500/10",
};

/** Point where the line from a rect's centre toward (tx,ty) leaves the rect. */
function edgePoint(p: Participant, tx: number, ty: number) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  if (dx === 0 && dy === 0) return { x: p.x, y: p.y };
  const s = Math.min(dx !== 0 ? W / 2 / Math.abs(dx) : Infinity, dy !== 0 ? H / 2 / Math.abs(dy) : Infinity);
  return { x: p.x + dx * s, y: p.y + dy * s };
}

function geometry(e: Edge) {
  const a = participantById(e.from)!;
  const b = participantById(e.to)!;
  const p1 = edgePoint(a, b.x, b.y);
  const p2 = edgePoint(b, a.x, a.y);
  return { p1, p2, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
}

export function ArchitectureExplorer({ startTour = false }: { startTour?: boolean }) {
  const [sel, setSel] = useState<Sel>(null);
  const [tour, setTour] = useState<number | null>(startTour ? 0 : null);
  const [playing, setPlaying] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Real interactions this session, so every message can say how often it actually happened.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch("/api/playground/inspector/events?limit=1000")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { events: { op: string; actor: string }[] } | null) => {
          if (!live || !d) return;
          const c: Record<string, number> = {};
          for (const e of d.events) if (e.actor === "platform" || e.op === "order_event_webhook") c[e.op] = (c[e.op] ?? 0) + 1;
          setCounts(c);
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!playing || tour === null) return;
    const t = setInterval(() => setTour((i) => (i === null ? i : i + 1 >= TOUR.length ? (setPlaying(false), i) : i + 1)), 6000);
    return () => clearInterval(t);
  }, [playing, tour]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const step = tour !== null ? TOUR[tour]! : null;
  const activeNodes = useMemo(() => new Set(step?.nodes ?? []), [step]);
  const activeEdges = useMemo(() => new Set(step?.edges ?? []), [step]);
  const dim = (on: boolean) => (step && !on ? "opacity-30" : "");

  const select = useCallback((s: Sel) => {
    setSel(s);
    setTimeout(() => panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 0);
  }, []);
  const stopTour = () => {
    setTour(null);
    setPlaying(false);
  };

  const node = sel?.type === "node" ? participantById(sel.id) : undefined;
  const edge = sel?.type === "edge" ? edgeById(sel.id) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {tour === null ? (
          <Button onClick={() => { setSel(null); setTour(0); }} data-testid="start-tour"><Play className="size-4" /> Start guided tour: a purchase, end to end</Button>
        ) : (
          <Button variant="outline" onClick={stopTour} data-testid="stop-tour"><Square className="size-4" /> End tour</Button>
        )}
        <p className="text-xs text-muted-foreground">Click a participant or a message to see what it does and what is real. Everything named here is checked against the code by tests.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
        {(["real", "simulated", "human"] as Kind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-sm border-2", KIND_STYLE[k])} aria-hidden /> {KIND_LABEL[k]}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-6 border-t-2 border-foreground/70" aria-hidden /> UCP message</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-6 border-t-2 border-dashed border-foreground/70" aria-hidden /> payment-handler / internal</span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card p-2">
        <svg viewBox="0 0 1000 520" role="group" aria-label="UCP participants and the messages between them" className="mx-auto h-auto w-full min-w-[640px]" data-testid="diagram">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker>
          </defs>

          {EDGES.map((e) => {
            const g = geometry(e);
            const on = activeEdges.has(e.id);
            const chosen = sel?.type === "edge" && sel.id === e.id;
            const label = e.label;
            return (
              <g key={e.id} className={cn("text-foreground/60 transition-opacity", dim(on), (on || chosen) && "text-primary")} data-edge={e.id} data-active={on || undefined}>
                <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} stroke="currentColor" strokeWidth={on || chosen ? 3 : 1.75} strokeDasharray={e.dashed || e.type === "handler" || e.type === "internal" ? "6 5" : undefined} markerEnd="url(#arrow)" className={cn(on && "ucp-flow")} />
                <g role="button" tabIndex={0} aria-label={`Message: ${e.label}. ${participantById(e.from)!.name} to ${participantById(e.to)!.name}`} aria-pressed={chosen} className="cursor-pointer outline-none [&:focus-visible_rect]:stroke-primary" onClick={() => select({ type: "edge", id: e.id })} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), select({ type: "edge", id: e.id }))} data-testid={`edge-${e.id}`}>
                  <line x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y} stroke="transparent" strokeWidth={22} />
                  <rect x={g.mx - label.length * 3.4 - 8} y={g.my - 11} width={label.length * 6.8 + 16} height={22} rx={11} className="fill-background stroke-border" strokeWidth={1.25} />
                  <text x={g.mx} y={g.my + 4} textAnchor="middle" className="fill-foreground text-[11px]">{label}</text>
                </g>
              </g>
            );
          })}

          {PARTICIPANTS.map((p) => {
            const on = activeNodes.has(p.id);
            const chosen = sel?.type === "node" && sel.id === p.id;
            return (
              <g key={p.id} role="button" tabIndex={0} aria-pressed={chosen} aria-label={`${p.name} (${KIND_LABEL[p.kind]})`} className={cn("cursor-pointer outline-none transition-opacity [&:focus-visible_rect]:stroke-primary [&:focus-visible_rect]:stroke-[3]", dim(on))} onClick={() => select({ type: "node", id: p.id })} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), select({ type: "node", id: p.id }))} data-testid={`node-${p.id}`} data-active={on || undefined}>
                <rect x={p.x - W / 2} y={p.y - H / 2} width={W} height={H} rx={12} strokeWidth={chosen || on ? 3 : 2} strokeDasharray={p.kind === "simulated" ? "7 4" : undefined} className={cn("fill-card", p.kind === "real" && "stroke-emerald-500", p.kind === "simulated" && "stroke-amber-500", p.kind === "human" && "stroke-muted-foreground", (chosen || on) && "stroke-primary")} />
                <text x={p.x} y={p.y - 6} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{p.name.length > 24 ? `${p.name.slice(0, 22)}…` : p.name}</text>
                <text x={p.x} y={p.y + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">{p.role} · {p.kind === "simulated" ? "simulated" : p.kind === "real" ? "real" : "you"}</text>
              </g>
            );
          })}
        </svg>
      </div>

      {step && (
        <div className="space-y-3 rounded-lg border-2 border-primary/50 p-4" role="region" aria-label="Guided tour" aria-live="polite" data-testid="tour-card">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold" data-testid="tour-title">{step.title}</h2>
            <span className="ml-auto text-xs text-muted-foreground">step {tour! + 1} of {TOUR.length}</span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-muted" aria-hidden><div className="h-full bg-primary transition-all" style={{ width: `${((tour! + 1) / TOUR.length) * 100}%` }} /></div>
          <p className="text-sm">{step.narration}</p>
          <p className="text-xs text-muted-foreground">Spec: {step.spec}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setTour((i) => Math.max(0, (i ?? 0) - 1))} disabled={tour === 0} data-testid="tour-prev"><ChevronLeft className="size-4" /> Back</Button>
            <Button size="sm" onClick={() => setTour((i) => Math.min(TOUR.length - 1, (i ?? 0) + 1))} disabled={tour === TOUR.length - 1} data-testid="tour-next">Next <ChevronRight className="size-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)} data-testid="tour-play">{playing ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Auto-play</>}</Button>
            <Link href={step.tryIt.href} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">{step.tryIt.label} <ArrowRight className="size-4" /></Link>
          </div>
        </div>
      )}

      <div ref={panelRef} aria-live="polite">
        {node && <NodeDetail p={node} onClose={() => setSel(null)} />}
        {edge && <EdgeDetail e={edge} counts={counts} onClose={() => setSel(null)} />}
        {!sel && !step && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nothing selected. Pick a box or a message above, or use the lists below (keyboard friendly, and the way to explore on a small screen).</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section aria-labelledby="plist" className="min-w-0"><h2 id="plist" className="mb-2 text-sm font-medium text-muted-foreground">Participants</h2>
          <ul className="space-y-1">{PARTICIPANTS.map((p) => (
            <li key={p.id}><button type="button" onClick={() => select({ type: "node", id: p.id })} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent" data-testid={`list-node-${p.id}`}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span><Badge variant="outline" className="text-[10px]">{KIND_LABEL[p.kind]}</Badge></button></li>
          ))}</ul>
        </section>
        <section aria-labelledby="elist" className="min-w-0"><h2 id="elist" className="mb-2 text-sm font-medium text-muted-foreground">Messages</h2>
          <ul className="space-y-1">{EDGES.map((e) => (
            <li key={e.id}><button type="button" onClick={() => select({ type: "edge", id: e.id })} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent" data-testid={`list-edge-${e.id}`}>
              <span className="min-w-0 flex-1 truncate">{participantById(e.from)!.name} → {participantById(e.to)!.name}: {e.label}</span></button></li>
          ))}</ul>
        </section>
      </div>
    </div>
  );
}

function Panel({ title, badge, onClose, children, testid }: { title: string; badge?: React.ReactNode; onClose: () => void; children: React.ReactNode; testid: string }) {
  return (
    <section className="space-y-3 rounded-lg border p-4 text-sm" aria-label={title} data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{title}</h2>{badge}<button type="button" onClick={onClose} aria-label="Close details" className="ml-auto rounded p-1 hover:bg-accent"><X className="size-4" /></button></div>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 pl-5">{items.map((i) => <li key={i}>{i}</li>)}</ul>;
}

function NodeDetail({ p, onClose }: { p: Participant; onClose: () => void }) {
  return (
    <Panel title={p.name} onClose={onClose} testid="node-detail" badge={<Badge variant="outline" className={cn(p.kind === "simulated" && "border-amber-500/60 text-amber-700 dark:text-amber-400", p.kind === "real" && "border-emerald-500/60 text-emerald-700 dark:text-emerald-400")}>{KIND_LABEL[p.kind]}</Badge>}>
      <p>{p.responsibility}</p>
      <div><div className="mb-1 text-xs font-medium text-muted-foreground">What it does</div><List items={p.does} /></div>
      <p className="rounded-md bg-muted/50 p-2 text-xs"><strong>What is real:</strong> {p.honesty}</p>
      {p.endpoints.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Endpoints it serves</div><ul className="space-y-0.5 font-mono text-xs">{p.endpoints.map((e) => <li key={e}>{e}</li>)}</ul></div>}
      <div><div className="mb-1 text-xs font-medium text-muted-foreground">Code</div><ul className="space-y-0.5 font-mono text-xs">{p.code.map((c) => <li key={c}>{c}</li>)}</ul></div>
      <div className="flex flex-wrap gap-3">{p.pages.map((x) => <Link key={x.href} href={x.href} className="inline-flex items-center gap-1 text-primary hover:underline">{x.label} <ArrowRight className="size-3.5" /></Link>)}</div>
    </Panel>
  );
}

function EdgeDetail({ e, counts, onClose }: { e: Edge; counts: Record<string, number>; onClose: () => void }) {
  const from = participantById(e.from)!;
  const to = participantById(e.to)!;
  return (
    <Panel title={`${from.name} → ${to.name}: ${e.label}`} onClose={onClose} testid="edge-detail" badge={<Badge variant="outline">{e.type === "wire" ? "UCP message" : e.type === "handler" ? "payment handler" : e.type === "human" ? "person ↔ UI" : "internal"}</Badge>}>
      <p>{e.description}</p>
      {e.ops.length > 0 && (
        <div><div className="mb-1 text-xs font-medium text-muted-foreground">Operations (as named in the Protocol Inspector), with how often this session actually did them</div>
          <ul className="flex flex-wrap gap-2">{e.ops.map((op) => (
            <li key={op}><Link href={`/inspector?op=${op}`} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs hover:bg-accent">{op} <span className="rounded bg-muted px-1">×{counts[op] ?? 0}</span></Link></li>
          ))}</ul></div>
      )}
      {e.endpoints.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Endpoints</div><ul className="space-y-0.5 font-mono text-xs">{e.endpoints.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <div><div className="mb-1 text-xs font-medium text-muted-foreground">Specification</div><List items={e.spec} /></div>
    </Panel>
  );
}
