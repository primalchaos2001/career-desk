import type { ResumeDoc } from "@tailorats/core";
import { useState } from "react";
import { toast } from "sonner";
import { applyCvToProfile, assistantPrompt, cvFromAssistantJson, emptyCv } from "../lib/cv/builder";
import { CV_THEMES, type CvTheme, resumeToRenderCv } from "../lib/cv/rendercv";
import type { Profile } from "../lib/workspace";
import { downloadCvPdf, renderCvPdf } from "./cvPdf";
import { Button, Chip, Field } from "./ui";

const THEME_LABELS: Record<CvTheme, string> = {
  classic: "Classic (blue headings)",
  sb2nov: "Serif (Jake's style)",
  engineeringresumes: "Engineering (dense, one page)",
  moderncv: "Modern (left dates)",
};

const lines = (s: string) =>
  s
    .split("\n")
    .map((v) => v.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
const list = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
const opt = (s: string) => s.trim() || undefined;

/**
 * Build or edit a CV without a file: a form, a choice of four ready-made
 * layouts, or help from ChatGPT/Gemini/Antigravity through a copy-paste prompt.
 * Saving stores the CV in the profile and, when the local server is running,
 * the PDF too, so applications and emails can attach it.
 */
export function CvBuilder({
  profile,
  role,
  local,
  save,
  close,
}: {
  profile: Profile;
  role: string;
  local: boolean;
  save: (p: Profile) => Promise<void>;
  close: () => void;
}) {
  const [doc, setDoc] = useState<ResumeDoc>(() =>
    structuredClone(profile.resumeDoc ?? emptyCv(profile)),
  );
  const [theme, setTheme] = useState<CvTheme>(
    (CV_THEMES as readonly string[]).includes(profile.cvTheme)
      ? (profile.cvTheme as CvTheme)
      : "classic",
  );
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (fn: (d: ResumeDoc) => void) =>
    setDoc((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  const b = doc.basics;

  const submit = async () => {
    if (!b.name.trim()) return toast.error("Add your name first");
    setBusy(true);
    try {
      let next = { ...applyCvToProfile(profile, doc), cvTheme: theme };
      if (local) {
        const base64 = await renderCvPdf(resumeToRenderCv(doc, { theme }));
        next = {
          ...next,
          resumeFile: {
            name: `${b.name.replace(/[^\w .-]/g, "_")} CV.pdf`,
            mime: "application/pdf",
            base64,
          },
        };
      }
      await save(next);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cd-cv-builder">
      <details className="cd-panel" open={!profile.resumeDoc}>
        <summary>
          <strong>Short on time? Let ChatGPT, Gemini or Antigravity interview you</strong>
        </summary>
        <ol className="cd-subtle">
          <li>Copy the instructions and paste them into your assistant.</li>
          <li>Answer its questions. It must use only what you tell it.</li>
          <li>Paste its final reply below, then check every line in the form.</li>
        </ol>
        <div className="cd-form-actions">
          <Button
            secondary
            onClick={() =>
              void navigator.clipboard
                .writeText(assistantPrompt(role))
                .then(() => toast.success("Instructions copied"))
                .catch(() => toast.error("Couldn't copy; select the text below instead"))
            }
          >
            Copy instructions
          </Button>
        </div>
        <Field
          label="Paste the assistant's reply"
          area
          value={pasted}
          onChange={setPasted}
          placeholder='{"basics": {"name": …'
        />
        <div className="cd-form-actions">
          <Button
            secondary
            disabled={!pasted.trim()}
            onClick={() => {
              try {
                setDoc(cvFromAssistantJson(pasted));
                setPasted("");
                toast.success("Filled in. Read every line before saving.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Fill the form from it
          </Button>
        </div>
      </details>

      <section className="cd-panel">
        <h3>Pick a layout</h3>
        <p className="cd-subtle">
          All four are text-based PDFs that applicant tracking systems read well.
        </p>
        <div className="cd-template-gallery">
          {CV_THEMES.map((t) => (
            <label key={t} className={`cd-template-card ${theme === t ? "selected" : ""}`}>
              <input
                type="radio"
                name="cv-theme"
                checked={theme === t}
                onChange={() => setTheme(t)}
              />
              <img src={`/cv-templates/${t}.png`} alt={`${THEME_LABELS[t]} layout example`} />
              <span>{THEME_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="cd-panel">
        <h3>About you</h3>
        <div className="cd-form-grid">
          <Field
            label="Full name"
            required
            value={b.name}
            onChange={(v) =>
              set((d) => {
                d.basics.name = v;
              })
            }
          />
          <Field
            label="Job title you want"
            value={b.label ?? ""}
            onChange={(v) =>
              set((d) => {
                d.basics.label = opt(v);
              })
            }
          />
          <Field
            label="Email"
            type="email"
            value={b.email ?? ""}
            onChange={(v) =>
              set((d) => {
                d.basics.email = opt(v);
              })
            }
          />
          <Field
            label="Phone"
            hint="With country code, e.g. +91 98…"
            value={b.phone ?? ""}
            onChange={(v) =>
              set((d) => {
                d.basics.phone = opt(v);
              })
            }
          />
          <Field
            label="City"
            value={b.location?.city ?? ""}
            onChange={(v) =>
              set((d) => {
                d.basics.location = v ? { city: v } : undefined;
              })
            }
          />
          <Field
            label="LinkedIn username"
            value={b.profiles.find((x) => x.network === "LinkedIn")?.username ?? ""}
            onChange={(v) =>
              set((d) => {
                d.basics.profiles = d.basics.profiles.filter((x) => x.network !== "LinkedIn");
                if (v.trim()) d.basics.profiles.push({ network: "LinkedIn", username: v.trim() });
              })
            }
          />
        </div>
        <Field
          label="Summary (2–3 sentences)"
          area
          value={b.summary ?? ""}
          onChange={(v) =>
            set((d) => {
              d.basics.summary = opt(v);
            })
          }
        />
      </section>

      <EntryList
        title="Work experience and internships"
        empty="No jobs yet? Skip this; projects and education carry a first CV."
        items={doc.work}
        add={() => set((d) => void d.work.push({ name: "", highlights: [] }))}
        remove={(i) => set((d) => void d.work.splice(i, 1))}
        render={(w, i) => (
          <div className="cd-form-grid">
            <Field
              label="Employer"
              value={w.name}
              onChange={(v) =>
                set((d) => {
                  const x = d.work[i];
                  if (x) x.name = v;
                })
              }
            />
            <Field
              label="Job title"
              value={w.position ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.work[i];
                  if (x) x.position = opt(v);
                })
              }
            />
            <Field
              label="Started"
              type="month"
              value={w.startDate ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.work[i];
                  if (x) x.startDate = opt(v);
                })
              }
            />
            <Field
              label="Ended"
              type="month"
              hint="Leave empty if you work there now"
              value={w.endDate ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.work[i];
                  if (x) x.endDate = opt(v);
                })
              }
            />
            <Field
              label="What you did (one per line)"
              area
              hint="Start with a verb. Add numbers only if you know them."
              value={w.highlights.join("\n")}
              onChange={(v) =>
                set((d) => {
                  const x = d.work[i];
                  if (x) x.highlights = lines(v);
                })
              }
            />
          </div>
        )}
      />

      <EntryList
        title="Education"
        items={doc.education}
        add={() =>
          set((d) => void d.education.push({ institution: "", courses: [], coursework: [] }))
        }
        remove={(i) => set((d) => void d.education.splice(i, 1))}
        render={(e, i) => (
          <div className="cd-form-grid">
            <Field
              label="College or school"
              value={e.institution}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.institution = v;
                })
              }
            />
            <Field
              label="Degree"
              placeholder="BTech, MBA…"
              value={e.studyType ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.studyType = opt(v);
                })
              }
            />
            <Field
              label="Field"
              value={e.area ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.area = opt(v);
                })
              }
            />
            <Field
              label="Grade"
              placeholder="8.2/10 CGPA"
              value={e.score ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.score = opt(v);
                })
              }
            />
            <Field
              label="Started"
              type="month"
              value={e.startDate ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.startDate = opt(v);
                })
              }
            />
            <Field
              label="Finished"
              type="month"
              value={e.endDate ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.education[i];
                  if (x) x.endDate = opt(v);
                })
              }
            />
          </div>
        )}
      />

      <EntryList
        title="Projects"
        items={doc.projects}
        add={() =>
          set((d) => void d.projects.push({ name: "", highlights: [], keywords: [], roles: [] }))
        }
        remove={(i) => set((d) => void d.projects.splice(i, 1))}
        render={(p, i) => (
          <div className="cd-form-grid">
            <Field
              label="Project name"
              value={p.name}
              onChange={(v) =>
                set((d) => {
                  const x = d.projects[i];
                  if (x) x.name = v;
                })
              }
            />
            <Field
              label="One-line description"
              value={p.description ?? ""}
              onChange={(v) =>
                set((d) => {
                  const x = d.projects[i];
                  if (x) x.description = opt(v);
                })
              }
            />
            <Field
              label="What you did (one per line)"
              area
              value={p.highlights.join("\n")}
              onChange={(v) =>
                set((d) => {
                  const x = d.projects[i];
                  if (x) x.highlights = lines(v);
                })
              }
            />
          </div>
        )}
      />

      <section className="cd-panel">
        <h3>Skills, certificates and languages</h3>
        <Field
          label="Skills (comma separated)"
          hint="Tools, languages and methods you can talk about in an interview."
          value={doc.skills.flatMap((s) => s.keywords).join(", ")}
          onChange={(v) =>
            set((d) => {
              d.skills = list(v).length ? [{ name: "Skills", keywords: list(v) }] : [];
            })
          }
        />
        <Field
          label="Certificates (one per line)"
          area
          value={doc.certificates.map((c) => c.name).join("\n")}
          onChange={(v) =>
            set((d) => {
              d.certificates = lines(v).map((name) => ({ name }));
            })
          }
        />
        <Field
          label="Languages (comma separated)"
          value={doc.languages.map((l) => l.language).join(", ")}
          onChange={(v) =>
            set((d) => {
              d.languages = list(v).map((language) => ({ language }));
            })
          }
        />
      </section>

      <div className="cd-form-actions">
        {local && (
          <Button
            secondary
            disabled={busy || !b.name.trim()}
            onClick={() => void downloadCvPdf(resumeToRenderCv(doc, { theme }), b.name || "CV")}
          >
            Preview PDF
          </Button>
        )}
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : "Save my CV"}
        </Button>
        <Chip>NO AI NEEDED</Chip>
      </div>
    </div>
  );
}

function EntryList<T>({
  title,
  empty,
  items,
  add,
  remove,
  render,
}: {
  title: string;
  empty?: string;
  items: T[];
  add: () => void;
  remove: (i: number) => void;
  render: (item: T, i: number) => React.ReactNode;
}) {
  return (
    <section className="cd-panel">
      <h3>{title}</h3>
      {!items.length && empty && <p className="cd-subtle">{empty}</p>}
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id; order is the identity
        <div key={i} className="cd-entry">
          {render(item, i)}
          <button type="button" className="cd-text-button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="cd-text-button" onClick={add}>
        ＋ Add
      </button>
    </section>
  );
}
