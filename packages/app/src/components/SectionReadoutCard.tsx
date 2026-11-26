import type { SectionReadout } from "@/lib/report";

interface SectionReadoutCardProps {
  readout: SectionReadout;
}

export function SectionReadoutCard({ readout }: SectionReadoutCardProps) {
  const { strengths, gaps, benchmark } = readout;
  const hasStrengths = strengths.length > 0;
  const hasGaps = gaps.length > 0;
  if (!hasStrengths && !hasGaps && !benchmark) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Section summary
      </p>
      {benchmark && <p className="mt-0.5 text-sm italic text-muted-foreground">{benchmark}</p>}

      {(hasStrengths || hasGaps) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {hasStrengths && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Strengths
              </p>
              <ul className="space-y-1">
                {strengths.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300"
                  >
                    <span
                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[10px]"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasGaps && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Gaps
              </p>
              <ul className="space-y-1">
                {gaps.map((g) => (
                  <li
                    key={g}
                    className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300"
                  >
                    <span
                      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[10px]"
                      aria-hidden="true"
                    >
                      −
                    </span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
