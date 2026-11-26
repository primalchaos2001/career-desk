import { useState } from "react";
import { toast } from "sonner";
import type { Finding } from "../lib/contacts/finder";
import { addContact } from "../lib/outreach";
import { type Job, must, type Workspace } from "../lib/workspace";
import { Button, Chip, Empty, Field } from "./ui";

type Mutate = (fn: (w: Workspace) => void, message?: string) => Promise<boolean>;

interface SearchResult {
  site: string;
  acceptsMail: boolean | null;
  pagesRead: { url: string; source: string; ok: boolean; note?: string }[];
  findings: Finding[];
  advice: string;
}

const KIND_LABEL: Record<Finding["kind"], string> = {
  recruiting: "RECRUITING INBOX",
  person: "PERSON",
  general: "GENERAL INBOX",
};

/**
 * Finds recruiter emails that are published for one job (job post, employer's
 * careers/contact pages) and lets the user save the ones they checked.
 */
export function FindContacts({ job, mutate }: { job: Job; mutate: Mutate }) {
  const [website, setWebsite] = useState(job.website ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());

  const search = async () => {
    setBusy(true);
    try {
      const site = website.trim();
      if (site && site !== job.website) {
        // Remember the site so the next search (or your assistant) can use it.
        const ok = await mutate((next) => {
          must(next.jobs.find((j) => j.id === job.id)).website = /^https?:\/\//i.test(site)
            ? site
            : `https://${site}`;
        }, "");
        if (!ok) return;
      }
      const r = await fetch("/__career-desk/contacts/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, website: site || undefined }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "The search failed");
      setResult(json as SearchResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (f: Finding) => {
    const ok = await mutate((next) => {
      addContact(next, {
        campaignId: job.campaignId,
        company: job.company,
        email: f.email,
        sourceUrl: f.sourceUrl,
        name: f.name,
        role: f.role,
        notes: [`Found on the ${f.source} for ${job.title}.`, f.note].filter(Boolean).join(" "),
      });
    }, "Contact saved. Draft an email from Outreach.");
    if (ok) setSaved(new Set([...saved, f.email]));
  };

  return (
    <div className="cd-find-contacts">
      <p className="cd-subtle">
        Reads the job post and {job.company}'s own careers, jobs and contact pages for published
        email addresses. It never guesses addresses. Open each page to check before saving.
      </p>
      <div className="cd-form-grid">
        <Field
          label="Company website"
          value={website}
          onChange={setWebsite}
          placeholder="https://company.com"
          hint="Needed when the job came from LinkedIn, Indeed or Naukri"
        />
      </div>
      <div className="cd-form-actions cd-email-actions">
        <Button disabled={busy} onClick={() => void search()}>
          {busy ? "Reading pages…" : "⌕ Find published emails"}
        </Button>
      </div>
      {result && (
        <>
          <p className="cd-subtle">
            {result.advice}
            {result.acceptsMail === false && " The company's domain doesn't seem to accept email."}
          </p>
          {!result.findings.length ? (
            <Empty icon="✉" title="No published address">
              {result.site
                ? `Read ${result.pagesRead.filter((p) => p.ok).length} pages on ${result.site}.`
                : "Add the company's website and search again."}
            </Empty>
          ) : (
            <div className="cd-session-list">
              {result.findings.map((f) => {
                const done = f.alreadySaved || saved.has(f.email);
                return (
                  <article className="cd-panel" key={f.email}>
                    <div className="cd-panel-heading">
                      <Chip tone={f.kind === "general" ? "" : "green"}>{KIND_LABEL[f.kind]}</Chip>
                      <a href={f.sourceUrl} target="_blank" rel="noreferrer">
                        {f.source} ↗
                      </a>
                    </div>
                    <h3>{f.email}</h3>
                    {(f.name || f.role) && (
                      <p className="cd-subtle">{[f.name, f.role].filter(Boolean).join(", ")}</p>
                    )}
                    {f.snippet && <blockquote className="cd-snippet">…{f.snippet}…</blockquote>}
                    {f.note && <div className="cd-warning">△ {f.note}</div>}
                    <div className="cd-card-actions">
                      <Button secondary={done} disabled={done} onClick={() => void save(f)}>
                        {done ? "Saved ✓" : "I checked it, save contact"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <details>
            <summary className="cd-subtle">Pages read ({result.pagesRead.length})</summary>
            <ul className="cd-subtle">
              {result.pagesRead.map((p) => (
                <li key={p.url}>
                  {p.ok ? "✓" : "✕"} {p.url}
                  {p.note ? ` (${p.note})` : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
