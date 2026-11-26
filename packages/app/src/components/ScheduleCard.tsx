import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  EXTEND_DAYS,
  extendSchedule,
  needsExtension,
  scheduleState,
  startSchedule,
  stopSchedule,
} from "../lib/schedule";
import type { Campaign, Workspace } from "../lib/workspace";
import { Button, Chip } from "./ui";

type Mutate = (fn: (w: Workspace) => void, message?: string) => Promise<boolean>;

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Morning search status and controls for one campaign. */
export function ScheduleCard({
  c,
  mutate,
  hasAssistant,
}: {
  c: Campaign;
  mutate: Mutate;
  hasAssistant: boolean;
}) {
  const [assistant, setAssistant] = useState(false);
  const [autostart, setAutostart] = useState<{ available: boolean; enabled: boolean } | null>(null);
  useEffect(() => {
    fetch("/__career-desk/autostart", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAutostart(d?.supported && d.available ? d : null))
      .catch(() => setAutostart(null));
  }, []);
  const toggleAutostart = async (enabled: boolean) => {
    try {
      const r = await fetch("/__career-desk/autostart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn't change that");
      setAutostart({ available: true, enabled: d.enabled });
      toast.success(
        d.enabled
          ? "Career Desk will start minimised when you sign in to Windows"
          : "Career Desk won't start with Windows",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const st = scheduleState(c, new Date());
  const s = c.schedule;
  const change = (fn: (x: Campaign) => void, message: string) =>
    void mutate((next) => {
      const x = next.campaigns.find((v) => v.id === c.id);
      if (x) fn(x);
    }, message);
  const usage = s?.useAssistant
    ? " Your assistant also searches each morning, which uses your ChatGPT plan's usage."
    : " Job boards only: free, no AI usage.";

  return (
    <section className="cd-panel">
      <div className="cd-panel-heading">
        <h2>Morning search · {c.name}</h2>
        <Chip tone={st.kind === "active" ? "green" : ""}>
          {st.kind === "active" ? `ON · ${s?.time}` : st.kind === "ended" ? "ENDED" : "OFF"}
        </Chip>
      </div>
      {st.kind === "off" && (
        <>
          <p className="cd-subtle">
            Search LinkedIn, Indeed and Naukri every morning at 9:00 for a week and save new
            matches. Runs while Career Desk is open; a missed morning runs when you next open it.
          </p>
          {hasAssistant && (
            <label className="cd-check">
              <input
                type="checkbox"
                checked={assistant}
                onChange={(e) => setAssistant(e.target.checked)}
              />{" "}
              Also let my AI assistant search each morning (uses your ChatGPT plan's usage)
            </label>
          )}
          <div className="cd-form-actions">
            <Button
              onClick={() =>
                change(
                  (x) => startSchedule(x, new Date(), { useAssistant: assistant }),
                  "Morning search on for a week",
                )
              }
            >
              Turn on for a week
            </Button>
          </div>
        </>
      )}
      {s && st.kind !== "off" && (
        <>
          <p className="cd-subtle">
            {st.kind === "active"
              ? `Daily at ${s.time} until ${dayLabel(s.until)}.`
              : `Ended on ${dayLabel(s.until)}.`}
            {usage}
            {s.lastResult ? ` Last run: ${s.lastResult}.` : ""}
          </p>
          {needsExtension(c, new Date()) && (
            <p className="cd-callout" role="status">
              {st.kind === "ended" ? "Your morning search has stopped." : "Today is the last day."}{" "}
              Keep searching for {EXTEND_DAYS} more days?{usage}
            </p>
          )}
          {autostart && st.kind === "active" && (
            <label className="cd-check">
              <input
                type="checkbox"
                checked={autostart.enabled}
                onChange={(e) => void toggleAutostart(e.target.checked)}
              />{" "}
              Start Career Desk (minimised) when I sign in to Windows, so the {s.time} search runs
              without me opening it
            </label>
          )}
          <div className="cd-form-actions">
            {needsExtension(c, new Date()) && (
              <Button
                onClick={() =>
                  change((x) => extendSchedule(x, new Date()), `Extended by ${EXTEND_DAYS} days`)
                }
              >
                Yes, {EXTEND_DAYS} more days
              </Button>
            )}
            {hasAssistant && st.kind === "active" && (
              <Button
                secondary
                onClick={() =>
                  change(
                    (x) => {
                      if (x.schedule) x.schedule.useAssistant = !x.schedule.useAssistant;
                    },
                    s.useAssistant
                      ? "Assistant search off"
                      : "Assistant search on (uses your plan's usage)",
                  )
                }
              >
                {s.useAssistant ? "Stop using my assistant" : "Also use my assistant"}
              </Button>
            )}
            <Button secondary onClick={() => change((x) => stopSchedule(x), "Morning search off")}>
              Turn off
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
