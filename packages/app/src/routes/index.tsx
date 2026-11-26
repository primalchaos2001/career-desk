import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { analyzeResume } from "@/lib/analyzeClient";
import {
  INDUSTRY_LABELS,
  type Industry,
  REGION_LABELS,
  type Region,
  ROLE_LABELS,
  type Role,
  STAGE_LABELS,
  type Stage,
} from "@/lib/report";
import { saveReport } from "@/lib/reportStore";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  const [region, setRegion] = useState<Region>("us");
  const [role, setRole] = useState<Role>("swe-intern");
  const [industry, setIndustry] = useState<Industry>("tech");
  const [stage, setStage] = useState<Stage>("student");
  const [jobDescription, setJobDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const selectFile = useCallback((f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File too big — 5 MB max.");
      return;
    }
    setFile(f);
  }, []);

  const analyze = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    try {
      setStatus("Analyzing in your browser — nothing is uploaded…");
      const report = await analyzeResume({
        file,
        region,
        role,
        industry,
        stage,
        jobDescription: jobDescription.trim() || undefined,
      });
      await saveReport(report);
      navigate({ to: "/analyze/$reportId", params: { reportId: report.id } });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }, [file, industry, jobDescription, navigate, region, role, stage]);

  return (
    <div className="bg-background text-foreground">
      {/* HERO */}
      <section className="container-page px-6 pt-24 pb-20 border-b border-foreground/10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 lg:col-span-7">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground mb-6 block">
              v2.0 / The Honest Analyzer
            </span>
            <h1 className="font-serif text-6xl md:text-7xl lg:text-8xl leading-[0.95] mb-8">
              Fix your CV.
              <br />
              <span className="italic">For real.</span>
            </h1>
            <p className="text-xl max-w-lg leading-relaxed text-foreground/80 mb-12">
              No "83% ATS pass rate" theatre. No subscription traps. A client-side tool that
              analyzes your résumé through three distinct lenses to reveal what recruiters actually
              see.
            </p>
            <div className="flex items-center gap-6">
              <a
                href="#analyze"
                className="px-8 py-4 bg-foreground text-background hover:bg-foreground/85 transition-colors font-medium"
              >
                Start Free Analysis →
              </a>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] w-28 leading-tight text-muted-foreground">
                100% Private &amp; Local
              </span>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5 relative flex items-start lg:pl-6">
            <div className="w-full border border-foreground/80 p-8 bg-card shadow-[12px_12px_0px_var(--paper-2)] rotate-2 hover:rotate-0 transition-transform duration-500">
              <div className="border-b border-foreground/10 pb-4 mb-6 flex justify-between items-end">
                <div className="font-mono text-[10px] uppercase tracking-widest">
                  Report Sample_018
                </div>
                <div className="w-12 h-1 bg-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { label: "Fidelity", score: 92, tone: "text-emerald-700" },
                  { label: "Findability", score: 67, tone: "text-amber-700" },
                  { label: "Impact", score: 54, tone: "text-red-700" },
                ].map((s) => (
                  <div key={s.label} className="border border-foreground/10 p-3">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      {s.label}
                    </p>
                    <p className={`mt-1 font-serif text-2xl ${s.tone}`}>{s.score}</p>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-foreground/10">
                <div className="font-mono text-[10px] uppercase tracking-widest mb-2">
                  The Verdict
                </div>
                <p className="font-serif italic text-sm leading-relaxed">
                  "Over-engineered descriptions hide the core impact of your 2022 project. Five
                  bullets start with 'Responsible for'."
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-16 flex flex-wrap gap-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {["100% Client-Side", "No Sign-Up", "No Servers", "Free Forever"].map((t) => (
            <span key={t} className="flex items-center gap-2">
              <span className="h-px w-6 bg-foreground/40" />
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* UPLOAD + CONTEXT */}
      <section
        id="analyze"
        className="container-page px-6 py-24 border-b border-foreground/10 scroll-mt-8"
      >
        <div className="grid grid-cols-12 gap-12">
          <div className="col-span-12 md:col-start-2 md:col-span-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Step 01
            </p>
            <h2 className="mt-3 font-serif text-4xl leading-tight">Context.</h2>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed">
              Raw data is useless without intent. Tell us where you are aiming so the analysis knows
              the target — the same résumé is read differently in different markets.
            </p>
            {busy && (
              <p className="mt-8 font-mono text-xs uppercase tracking-widest text-foreground animate-pulse">
                {status || "Working…"}
              </p>
            )}
          </div>
          <div className="col-span-12 md:col-span-6 space-y-12">
            <div className="border-b border-foreground pb-12">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] block mb-4">
                Drop Résumé Here
              </p>
              <FileDrop disabled={busy} selectedName={file?.name} onFile={selectFile} />
              <button
                type="button"
                onClick={analyze}
                disabled={!file || busy}
                className="mt-6 w-full bg-foreground px-4 py-4 text-sm font-medium uppercase tracking-[0.15em] text-background transition hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy
                  ? status || "Analyzing…"
                  : file
                    ? "Analyze Résumé →"
                    : "Drop a résumé to begin"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-8">
              <UnderlineSelect
                label="Region"
                value={region}
                onChange={(v) => setRegion(v as Region)}
                options={Object.entries(REGION_LABELS)}
              />
              <UnderlineSelect
                label="Role"
                value={role}
                onChange={(v) => setRole(v as Role)}
                options={Object.entries(ROLE_LABELS)}
              />
              <UnderlineSelect
                label="Industry"
                value={industry}
                onChange={(v) => setIndustry(v as Industry)}
                options={Object.entries(INDUSTRY_LABELS)}
              />
              <UnderlineSelect
                label="Stage"
                value={stage}
                onChange={(v) => setStage(v as Stage)}
                options={Object.entries(STAGE_LABELS)}
              />
            </div>

            <div>
              <label
                htmlFor="job-description"
                className="font-mono text-[10px] uppercase tracking-[0.2em] block mb-3"
              >
                Optional · Paste Job Description
              </label>
              <textarea
                id="job-description"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={5}
                placeholder="Paste the JD to sharpen findability advice…"
                className="w-full bg-transparent border-b border-foreground/40 pb-2 pt-1 text-sm focus:border-foreground focus:outline-none resize-none placeholder:text-muted-foreground/60"
              />
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Without a JD we still analyze — advice is just less specific.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* THREE LENSES */}
      <section className="container-page px-6 py-24">
        <div className="mb-16 max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Step 02 · What we measure
          </p>
          <h2 className="mt-3 font-serif text-4xl md:text-5xl leading-tight">
            Three Lenses of Truth.
          </h2>
          <p className="mt-4 text-muted-foreground italic font-serif">
            Three real scores. No invented number.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 border border-foreground">
          {[
            {
              n: "01 / ATS Parsing",
              t: "The Machine Eye",
              d: "How well an ATS can extract your text — columns, tables, images, exotic fonts. If it can't read your résumé, no recruiter ever will.",
            },
            {
              n: "02 / Findability",
              t: "The 6-Second Glance",
              d: "Standard sections, must-have fields for the role, region-appropriate content. We track density and hierarchy so your impact is unavoidable.",
            },
            {
              n: "03 / Narrative",
              t: "The Deep Read",
              d: "Verb strength, quantification, outcome clarity — once you pass the scan, the story matters. We evaluate the arc, not the keywords.",
            },
          ].map((c, i) => (
            <div
              key={c.n}
              className={`p-10 group hover:bg-foreground hover:text-background transition-colors ${
                i < 2 ? "border-b md:border-b-0 md:border-r border-foreground" : ""
              }`}
            >
              <span className="font-mono text-xs uppercase tracking-[0.15em] mb-10 block">
                {c.n}
              </span>
              <h3 className="font-serif text-2xl mb-4">{c.t}</h3>
              <p className="text-sm leading-relaxed opacity-70 group-hover:opacity-100">{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* COMPARISON */}
      <section className="px-6 py-24 bg-secondary/60 border-y border-foreground/10">
        <div className="container-page max-w-4xl">
          <div className="mb-12 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Why this exists
            </p>
            <h2 className="mt-3 font-serif text-3xl md:text-4xl">
              Vs. the <span className="italic">"premium"</span> scams.
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse">
              <thead>
                <tr className="border-b border-foreground">
                  <th className="text-left py-4 font-mono text-[10px] uppercase tracking-widest">
                    Feature
                  </th>
                  <th className="text-right py-4 px-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Them ($19–49/mo)
                  </th>
                  <th className="text-right py-4 font-mono text-[10px] uppercase tracking-widest">
                    CV Guide (Free)
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  ["Price", "$19–$49 / month", "Free, forever"],
                  ["Account required", "Yes, plus email nags", "No account"],
                  [
                    "Where your résumé goes",
                    "Their servers, unclear retention",
                    "Your browser only",
                  ],
                  ["“ATS score”", "Invented number", "We don't fake one"],
                  ["Advice", "Generic, gated behind paywall", "Prioritized, context-aware, free"],
                  ["Region-aware", "Rarely", "US, UK, DE, India"],
                ].map(([k, a, b]) => (
                  <tr key={k} className="border-b border-foreground/10">
                    <td className="py-6">{k}</td>
                    <td className="py-6 px-4 text-right text-muted-foreground">{a}</td>
                    <td className="py-6 text-right font-medium italic underline underline-offset-4">
                      {b}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="container-page px-6 py-24 max-w-3xl">
        <h2 className="font-serif text-4xl md:text-5xl mb-12 italic">Frequently questioned.</h2>
        <dl className="space-y-10">
          {[
            {
              q: "Is this really free?",
              a: "Yes. No trial, no card, no premium tier. There's nothing to sell — the app runs entirely in your browser, so there are no server bills to pay.",
            },
            {
              q: "Where does my résumé go?",
              a: "Nowhere. Parsing and scoring happen in this tab. Reports are stored in your browser's IndexedDB. Clearing site data deletes them.",
            },
            {
              q: "Do you give me an ATS score?",
              a: "No — because there's no real one to give. Recruiters see a ranked list, not a score. We show you what actually affects that ranking.",
            },
            {
              q: "Which regions do you support?",
              a: "US, UK, Germany, and India — each with its own résumé conventions (photo, GPA, address, page count).",
            },
          ].map((f) => (
            <div key={f.q} className="border-t border-foreground/15 pt-5">
              <dt className="font-serif text-xl">{f.q}</dt>
              <dd className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-16">
          <Link
            to="/ats"
            className="font-mono text-xs uppercase tracking-[0.2em] underline underline-offset-4"
          >
            Read: what ATS really do →
          </Link>
        </p>
      </section>

      {/* CLOSING CTA */}
      <section className="px-6 py-32 text-center bg-foreground text-background">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-background/60">
          Ready
        </p>
        <h2 className="mt-4 font-serif text-5xl md:text-7xl leading-[1.05]">Stop guessing.</h2>
        <p className="text-xl text-background/60 mt-6 mb-12 max-w-xl mx-auto">
          Get the honest feedback your peers are too polite to give you.
        </p>
        <a
          href="#analyze"
          className="px-12 py-5 bg-background text-foreground hover:bg-secondary transition-colors font-semibold text-sm uppercase tracking-[0.2em]"
        >
          Analyze My CV Now
        </a>
        <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-background/40">
          No sign-up · Nothing leaves this tab · ~5 seconds
        </p>
      </section>
    </div>
  );
}

function UnderlineSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  const id = `ctx-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="font-mono text-[10px] uppercase tracking-[0.2em] block mb-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent border-b border-foreground py-2 text-sm focus:outline-none appearance-none cursor-pointer"
      >
        {options.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function FileDrop({
  onFile,
  disabled,
  selectedName,
}: {
  onFile: (f: File) => void;
  disabled?: boolean;
  selectedName?: string;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`group border-2 border-dashed h-48 flex flex-col items-center justify-center text-center transition-colors ${
        drag
          ? "border-foreground bg-secondary"
          : selectedName
            ? "border-emerald-700/60 bg-secondary/30"
            : "border-foreground/20 bg-secondary/30 hover:bg-secondary/60"
      } ${disabled ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
    >
      {selectedName ? (
        <>
          <span className="font-serif italic text-2xl text-emerald-700">✓ {selectedName}</span>
          <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Set your context, then press Analyze · or choose a different file
          </span>
        </>
      ) : (
        <>
          <span className="font-serif italic text-2xl text-foreground/70 group-hover:text-foreground transition-colors">
            Drop résumé
          </span>
          <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            or click to browse · PDF or .tex · 5 MB max
          </span>
        </>
      )}
      <input
        type="file"
        accept=".pdf,.tex"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
