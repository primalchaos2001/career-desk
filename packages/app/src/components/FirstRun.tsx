import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type BoardPosting, boardQueries, rankPostings } from "../lib/boards";
import { profileFromCvFile } from "../lib/cvImport";
import { quickStartCampaign } from "../lib/onboarding";
import { localDay, startSchedule } from "../lib/schedule";
import { addJob, event, type Profile, type Workspace } from "../lib/workspace";
import { CvBuilder } from "./CvBuilder";
import { Button, Chip, Field } from "./ui";

type Mutate = (fn: (w: Workspace) => void, message?: string) => Promise<boolean>;

/** Leads saved straight away on the first search. */
const FIRST_SAVE = 10;

/**
 * Three steps from nothing to ranked jobs: your CV (or build one), what and
 * where (with expected salary), then the first search and the morning search.
 */
export function FirstRun({
  w,
  mutate,
  local,
  hasAssistant,
  done,
}: {
  w: Workspace;
  mutate: Mutate;
  /** The local server is running (job boards, PDFs, morning search). */
  local: boolean;
  hasAssistant: boolean;
  done: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(w.profile.name ? 2 : 1);
  const [p, setP] = useState<Profile>(structuredClone(w.profile));
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState("");
  const [role, setRole] = useState(w.profile.headline);
  const [city, setCity] = useState(w.profile.city);
  const [salary, setSalary] = useState(w.profile.expectedLpa);
  const [remote, setRemote] = useState(false);
  const [daily, setDaily] = useState(local);
  const [assistant, setAssistant] = useState(false);
  const top = useRef<HTMLElement>(null);
  // Each step starts at the top of the card, not wherever the last one scrolled to.
  useEffect(() => {
    if (step > 1 || building) top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [step, building]);

  const readCv = async (file: File) => {
    setBusy("Reading your CV…");
    try {
      const next = await profileFromCvFile(p, file);
      setP(next);
      setRole((r) => r || next.headline);
      setCity((c) => c || next.city);
      toast.success("CV read. Check the details below.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that CV");
    } finally {
      setBusy("");
    }
  };

  const start = async () => {
    if (!role.trim()) return toast.error("Tell us the role you want");
    setBusy(local ? "Searching LinkedIn, Indeed and Naukri… (up to a few minutes)" : "Saving…");
    try {
      // Build the campaign on a copy first, so the search can use it.
      const draft = structuredClone(w);
      draft.profile = p;
      const c = quickStartCampaign(draft, { role, city, expectedLpa: salary, remote });
      if (daily) {
        startSchedule(c, new Date(), { useAssistant: assistant });
        // Today's search is the one we run now.
        if (c.schedule) c.schedule.lastRunDay = localDay(new Date());
      }
      let picks: ReturnType<typeof rankPostings> = [];
      let found = 0;
      if (local) {
        try {
          const r = await fetch("/__career-desk/boards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ queries: boardQueries(c) }),
          });
          const json = (await r.json()) as { jobs?: BoardPosting[]; error?: string };
          if (!r.ok) throw new Error(json.error ?? "Job-board search failed");
          found = json.jobs?.length ?? 0;
          picks = rankPostings(draft, c.id, json.jobs ?? [])
            .filter((x) => x.match.eligible && !x.alreadySaved)
            .slice(0, FIRST_SAVE);
        } catch (e) {
          toast.error(`${(e as Error).message}. You can search again from Opportunities.`);
        }
      }
      const ok = await mutate((next) => {
        next.profile = draft.profile;
        next.campaigns.push(c);
        for (const x of picks)
          try {
            addJob(next, x.job);
          } catch {
            // duplicate
          }
        if (c.schedule)
          c.schedule.lastResult = `${picks.length} matches saved from ${found} postings`;
        event(next, `First search for ${c.name}: ${picks.length} matches saved`);
      }, "");
      if (ok) {
        toast.success(
          local
            ? `${picks.length} matching jobs saved. Best matches are at the top.`
            : "Campaign created.",
        );
        done();
      }
    } finally {
      setBusy("");
    }
  };

  if (building)
    return (
      <section className="cd-panel" ref={top}>
        <div className="cd-panel-heading">
          <h2>Build your CV</h2>
          <Button secondary onClick={() => setBuilding(false)}>
            Back
          </Button>
        </div>
        <CvBuilder
          profile={p}
          role={role}
          local={local}
          save={async (next) => {
            setP(next);
            setRole((r) => r || next.headline);
            setCity((c) => c || next.city);
            setStep(2);
          }}
          close={() => setBuilding(false)}
        />
      </section>
    );

  return (
    <section className="cd-panel cd-first-run" ref={top}>
      <div className="cd-panel-heading">
        <h2>Get started in three steps</h2>
        <Chip tone="green">STEP {step} OF 3</Chip>
      </div>
      {busy && (
        <p className="cd-callout" role="status">
          {busy}
        </p>
      )}

      {step === 1 && (
        <>
          <h3>1 · Your CV</h3>
          <div className="cd-choice-grid">
            <label className="cd-choice">
              <strong>I have a CV</strong>
              <small>PDF, LaTeX (.tex) or text. Read on this PC; nothing is uploaded.</small>
              <input
                type="file"
                accept=".pdf,.tex,.txt"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readCv(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className="cd-choice" onClick={() => setBuilding(true)}>
              <strong>I don't have one yet</strong>
              <small>
                Fill a short form or let ChatGPT, Gemini or Antigravity interview you, then pick a
                layout.
              </small>
            </button>
          </div>
          {p.resumeText && (
            <div className="cd-form-grid">
              <Field
                label="Your name"
                required
                value={p.name}
                onChange={(v) => setP({ ...p, name: v })}
              />
              <Field
                label="Email"
                type="email"
                required
                value={p.email}
                onChange={(v) => setP({ ...p, email: v })}
              />
              <Field
                label="Years of experience"
                hint="Worked out from your CV; internships not counted"
                value={p.experienceYears}
                onChange={(v) => setP({ ...p, experienceYears: v })}
              />
              <Field
                label="Skills found in your CV"
                area
                hint="Remove anything you can't talk about in an interview"
                value={p.skills}
                onChange={(v) => setP({ ...p, skills: v })}
              />
            </div>
          )}
          <div className="cd-form-actions">
            <Button secondary onClick={() => setStep(2)}>
              Skip for now
            </Button>
            <Button disabled={!p.resumeText || !p.name || !!busy} onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h3>2 · What and where</h3>
          <div className="cd-form-grid">
            <Field
              label="Role you want"
              required
              placeholder="e.g. Design Verification Engineer"
              value={role}
              onChange={setRole}
            />
            <Field label="City" placeholder="e.g. Bengaluru" value={city} onChange={setCity} />
            <Field
              label="Expected salary (lakh per year)"
              type="number"
              hint="Used to rank jobs; jobs without a listed salary aren't penalised"
              value={salary}
              onChange={setSalary}
            />
            <label className="cd-check">
              <input
                type="checkbox"
                checked={remote}
                onChange={(e) => setRemote(e.target.checked)}
              />{" "}
              Include remote jobs
            </label>
            {!p.name && (
              <Field
                label="Your name"
                required
                value={p.name}
                onChange={(v) => setP({ ...p, name: v })}
              />
            )}
            {!p.email && (
              <Field
                label="Your email"
                type="email"
                value={p.email}
                onChange={(v) => setP({ ...p, email: v })}
              />
            )}
          </div>
          <div className="cd-form-actions">
            <Button secondary onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={!role.trim()} onClick={() => setStep(3)}>
              Next
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <h3>3 · Find jobs</h3>
          <p className="cd-subtle">
            We'll search now and save the best matches for <strong>{role}</strong>
            {city ? ` in ${city}` : ""}. Nothing is applied for or sent.
          </p>
          {local ? (
            <>
              <label className="cd-check">
                <input
                  type="checkbox"
                  checked={daily}
                  onChange={(e) => setDaily(e.target.checked)}
                />{" "}
                Search again every morning at 9:00 for a week. Free (job boards, no AI). Runs while
                Career Desk is open. After a week we ask before continuing, three days at a time.
              </label>
              {hasAssistant && daily && (
                <label className="cd-check">
                  <input
                    type="checkbox"
                    checked={assistant}
                    onChange={(e) => setAssistant(e.target.checked)}
                  />{" "}
                  Also let my AI assistant search company career sites each morning.{" "}
                  <strong>This uses your ChatGPT plan's usage.</strong>
                </label>
              )}
            </>
          ) : (
            <p className="cd-callout">
              Job-board search and morning searches need the Career Desk app on your PC
              (double-click Career Desk.cmd). This web version saves your campaign only.
            </p>
          )}
          <div className="cd-form-actions">
            <Button secondary onClick={() => setStep(2)}>
              Back
            </Button>
            <Button disabled={!!busy} onClick={() => void start()}>
              {local ? "Find jobs now" : "Create campaign"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
