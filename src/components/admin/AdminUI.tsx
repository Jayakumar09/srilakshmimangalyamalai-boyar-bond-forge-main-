import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-6 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger";

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-secondary text-secondary-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-foreground",
    danger: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function toneForStatus(status: string): Tone {
  if (["approved", "verified", "ready", "closed"].includes(status)) return "success";
  if (["rejected"].includes(status)) return "danger";
  if (["pending", "submitted", "open", "uploaded"].includes(status)) return "warning";
  return "neutral";
}

export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Meter({ title, used, pct }: { title: string; used: string; pct: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <p className="mt-2 font-display text-lg font-semibold">{used}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", pct >= 90 ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{pct}%</p>
    </div>
  );
}
