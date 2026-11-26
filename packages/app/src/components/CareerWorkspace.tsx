import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { type BoardError, type BoardPosting, boardQueries, rankPostings } from "../lib/boards";
import { type ClaimWarning, checkClaims } from "../lib/claims";
import { CV_THEMES, type CvTheme, profileToResume, resumeToRenderCv } from "../lib/cv/rendercv";
import { profileFromCvFile } from "../lib/cvImport";
import {
  addContact,
  approveFill,
  approveOutreach,
  CONTACT_COOLDOWN_DAYS,
  claimSend,
  DAILY_SEND_LIMIT,
  editOutreach,
  emlFor,
  gmailComposeUrl,
  lastContacted,
  outreachAttachment,
  recordOutreachResult,
  rejectOutreach,
  sendQueue,
  setDoNotContact,
} from "../lib/outreach";
import { needsExtension } from "../lib/schedule";
import { plainText } from "../lib/text";
import {
  type Application,
  addJob,
  type Campaign,
  CampaignSchema,
  event,
  importWorkspace,
  type Job,
  type JobInput,
  jobCorpus,
  matchJob,
  mergeProfileEdit,
  must,
  now,
  type Profile,
  prepareApplication,
  renderTemplate,
  type Session,
  STATUSES,
  searchLinks,
  setApplicationStatus,
  type Template,
  TRACKS,
  uid,
  type Workspace,
  WorkspaceSchema,
} from "../lib/workspace";
import {
  ConflictError,
  type LiveStatus,
  openWorkspaceStore,
  type WorkspaceStore,
} from "../lib/workspaceStore";
import {
  ASSISTANT_GUIDE,
  downloadFile,
  FOLDER_GUIDE,
  parseCsv,
  printDocument,
  readWorkspaceFile,
  workspaceZip,
} from "../lib/workspaceTransfer";
import { FindContacts } from "./FindContacts";
import "./career.css";

const SECTIONS = [
  ["overview", "Overview", "◫"],
  ["campaigns", "Campaigns", "◎"],
  ["jobs", "Opportunities", "▤"],
  ["applications", "Applications", "↗"],
  ["outreach", "Outreach", "✉"],
  ["sessions", "Work sessions", "◷"],
  ["profile", "My profile", "♙"],
  ["templates", "Templates", "▧"],
  ["assistants", "Assistants & backup", "✦"],
] as const;
type Section = (typeof SECTIONS)[number][0];
const trackLabel: Record<string, string> = {
  consulting: "Consulting & strategy",
  product: "Product management",
  psychology: "Psychology & counselling",
  marketing: "Marketing & growth",
  finance: "Finance",
  hr: "Human resources",
  operations: "Operations",
  other: "Other profession",
};
const modeLabel: Record<string, string> = {
  research: "Research only",
  draft: "Research & draft",
  authorized: "Allow separately authorized actions",
};
const statusLabel: Record<string, string> = {
  prepared: "Prepared",
  attempted: "Attempted",
  blocked: "Blocked",
  unknown: "Needs verification",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const slug = (value: string) =>
  value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "document";

import { CvBuilder } from "./CvBuilder";
import { downloadCvPdf } from "./cvPdf";
import { FirstRun } from "./FirstRun";
import { ScheduleCard } from "./ScheduleCard";
import { Button, Chip, Empty, Field, Modal, Select } from "./ui";

export function CareerWorkspace() {
  const [w, setW] = useState<Workspace | null>(null);
  const live = useRef<Workspace | null>(null);
  const [store, setStore] = useState<WorkspaceStore | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  /** A file change arrived while saving; check again once the save is done. */
  const missedRef = useRef(false);
  const storeRef = useRef<WorkspaceStore | null>(null);
  const savingRef = useRef(false);
  const [loadingError, setLoadingError] = useState("");
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [campaignId, setCampaignId] = useState("all");
  const [modal, setModal] = useState<ReactNode>(null);
  const [hasAssistant, setHasAssistant] = useState(false);
  useEffect(() => {
    if (store?.kind !== "folder") return;
    fetch("/__career-desk/runs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { assistants?: unknown[] } | null) => setHasAssistant(!!d?.assistants?.length))
      .catch(() => setHasAssistant(false));
  }, [store?.kind]);
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    openWorkspaceStore()
      .then((s) => {
        storeRef.current = s;
        setStore(s);
        return s.load();
      })
      .then((value) => {
        live.current = value;
        setW(value);
      })
      .catch((e) => setLoadingError(String(e)));
    const hash = window.location.hash.slice(1);
    if (SECTIONS.some(([id]) => id === hash)) setSection(hash as Section);
  }, []);
  const reload = useCallback(async (message?: string) => {
    if (!storeRef.current) return;
    try {
      const value = await storeRef.current.load();
      live.current = value;
      setW(value);
      if (message) toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the workspace");
    }
  }, []);
  // Linked folder: show assistant edits as soon as workspace.json changes on disk.
  useEffect(() => {
    if (!store) return;
    return store.watch((change) => {
      if ("error" in change) {
        toast.error(
          `workspace.json can't be read: ${change.error}. Your last good version is still shown.`,
        );
        return;
      }
      if (savingRef.current) {
        missedRef.current = true;
        return;
      }
      if (change.revision === live.current?.revision) return;
      void reload(`Workspace updated outside the app (revision ${change.revision})`);
    }, setLiveStatus);
  }, [store, reload]);
  const go = (s: Section) => {
    setSection(s);
    setMobileNav(false);
    history.replaceState(null, "", `#${s}`);
  };
  const mutate = useCallback(
    async (fn: (next: Workspace) => void, message = "Saved") => {
      if (savingRef.current || !live.current || !storeRef.current) {
        toast.error("A save is in progress. Please try again.");
        return false;
      }
      savingRef.current = true;
      setSaving(true);
      try {
        const next = structuredClone(live.current);
        fn(next);
        const result = await storeRef.current.save(next, live.current.revision);
        live.current = result;
        setW(result);
        if (message) toast.success(message);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
        if (e instanceof ConflictError) void reload();
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (missedRef.current) {
          missedRef.current = false;
          void reload();
        }
      }
    },
    [reload],
  );
  const openCampaign = (campaign?: Campaign) => {
    if (!live.current) return;
    setModal(
      <CampaignForm
        campaign={campaign}
        templates={live.current.templates}
        close={() => setModal(null)}
        save={async (c) => {
          const ok = await mutate((next) => {
            const at = next.campaigns.findIndex((v) => v.id === c.id);
            if (at >= 0) next.campaigns[at] = c;
            else next.campaigns.push(c);
            event(next, `${at >= 0 ? "Updated" : "Created"} campaign: ${c.name}`);
          }, "Campaign saved");
          if (ok) {
            setCampaignId(c.id);
            setModal(null);
          }
        }}
      />,
    );
  };
  const openJob = (job?: Job) => {
    if (!live.current) return;
    if (!live.current.campaigns.length) {
      toast.error("Create a campaign first");
      go("campaigns");
      return;
    }
    setModal(
      <JobForm
        job={job}
        campaigns={live.current.campaigns}
        selected={campaignId}
        close={() => setModal(null)}
        save={async (input) => {
          const ok = await mutate((next) => {
            if (job) {
              const at = next.jobs.findIndex((v) => v.id === job.id);
              next.jobs[at] = { ...job, ...input };
              event(next, `Updated job: ${input.title}`);
            } else addJob(next, input);
          }, "Opportunity saved");
          if (ok) setModal(null);
        }}
      />,
    );
  };
  const openSession = (session?: Session) => {
    if (!live.current?.campaigns.length) {
      toast.error("Create a campaign first");
      go("campaigns");
      return;
    }
    setModal(
      <SessionForm
        session={session}
        campaigns={live.current.campaigns}
        selected={campaignId}
        close={() => setModal(null)}
        save={async (s) => {
          const ok = await mutate((next) => {
            const at = next.sessions.findIndex((v) => v.id === s.id);
            if (at >= 0) next.sessions[at] = s;
            else next.sessions.unshift(s);
            event(next, `${s.status === "completed" ? "Completed" : "Saved"} session: ${s.title}`);
          }, "Session saved");
          if (ok) setModal(null);
        }}
      />,
    );
  };
  if (!w)
    return (
      <div className="cd-loading">
        <div className="cd-mark">
          c<span>↗</span>
        </div>
        <h1>Career Desk</h1>
        <p>{loadingError || "Opening your private workspace…"}</p>
        {loadingError && <Button onClick={() => window.location.reload()}>Try again</Button>}
      </div>
    );
  const selectedCampaign = w.campaigns.find((c) => c.id === campaignId);
  const filteredJobs = w.jobs.filter(
    (j) => !j.archived && (campaignId === "all" || j.campaignId === campaignId),
  );
  const filteredApps = w.applications.filter(
    (a) => campaignId === "all" || a.campaignId === campaignId,
  );
  const filteredSessions = w.sessions.filter(
    (s) => campaignId === "all" || s.campaignId === campaignId,
  );
  const showApplication = (a: Application) =>
    setModal(
      <ApplicationEditor
        app={a}
        attachment={
          w.attachments.find((f) => f.id === a.attachmentId) ??
          live.current?.attachments.find((f) => f.id === a.attachmentId)
        }
        job={must(w.jobs.find((j) => j.id === a.jobId))}
        profile={w.profile}
        approveFill={async (value) => {
          const ok = await mutate(
            (next) => approveFill(next, a.id, value),
            value
              ? "Approved for form filling. Your assistant can now fill this form; you submit."
              : "Form-filling approval withdrawn",
          );
          if (ok) setModal(null);
        }}
        close={() => setModal(null)}
        save={async (updated) => {
          const ok = await mutate((next) => {
            const at = next.applications.findIndex((v) => v.id === a.id);
            next.applications[at] = { ...updated, status: must(next.applications[at]).status };
            setApplicationStatus(next, a.id, updated.status, updated.evidence);
          }, "Application updated");
          if (ok) setModal(null);
        }}
      />,
    );
  const prepare = async (job: Job) => {
    let prepared: Application | undefined;
    const ok = await mutate((next) => {
      prepared = prepareApplication(next, job.id);
    }, "Draft prepared. Nothing submitted.");
    if (ok && prepared) showApplication(prepared);
  };
  return (
    <div className="cd-app">
      <aside className={`cd-sidebar ${mobileNav ? "is-open" : ""}`}>
        <button className="cd-brand" type="button" onClick={() => go("overview")}>
          <span className="cd-mark">
            c<span>↗</span>
          </span>
          <span>
            career desk<span className="cd-brand-sub">YOUR NEXT CHAPTER</span>
          </span>
        </button>
        <div className="cd-sidebar-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {SECTIONS.map(([id, label, icon]) => (
            <button
              type="button"
              key={id}
              onClick={() => go(id)}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {id === "jobs" && w.jobs.filter((j) => !j.archived).length > 0 && (
                <b>{w.jobs.filter((j) => !j.archived).length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="cd-side-note">
          <span>↗</span>
          <strong>
            A stronger application
            <br />
            starts with your story.
          </strong>
          <p>Check your CV with the honest ATS analyzer.</p>
          <Link to="/">Open CV Guide ↗</Link>
        </div>
        <div className="cd-sidebar-foot">
          <div className="cd-avatar">
            {w.profile.name
              ? w.profile.name
                  .split(" ")
                  .map((s) => s[0])
                  .join("")
                  .slice(0, 2)
              : "You"}
          </div>
          <div>
            <strong>{w.profile.name || "Your workspace"}</strong>
            <span>Stored on this device</span>
          </div>
          <span className="cd-online" title="Local workspace" />
        </div>
      </aside>
      <div className="cd-main">
        <header className="cd-topbar">
          <button
            className="cd-menu"
            type="button"
            onClick={() => setMobileNav(!mobileNav)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <div className="cd-breadcrumb">
            Workspace <span>/</span> <strong>{SECTIONS.find(([id]) => id === section)?.[1]}</strong>
          </div>
          <div className="cd-top-actions">
            <span className="cd-local">
              <i />
              {saving ? "Saving…" : "Private by default"}
            </span>
            <button
              type="button"
              className="cd-icon-button"
              onClick={() => go("assistants")}
              title="Export and back up your workspace"
              aria-label="Back up workspace"
            >
              ↥
            </button>
          </div>
        </header>
        <main className="cd-content">
          <div className="cd-page-title">
            <div>
              <div className="cd-eyebrow">YOUR SEARCH, WITH INTENTION</div>
              <h1>
                {
                  {
                    overview: "Make your next move count.",
                    campaigns: "One goal. A focused campaign.",
                    jobs: "Find your kind of opportunity.",
                    applications: "Good applications, all in view.",
                    outreach: "Reach the right person, politely.",
                    sessions: "Pick up where you left off.",
                    profile: "Your story, in one place.",
                    templates: "Your voice. A head start.",
                    assistants: "Your workspace. Your assistant.",
                  }[section]
                }
              </h1>
              <p>
                {
                  {
                    overview:
                      "A little structure for a big next step. Keep every possibility moving.",
                    campaigns:
                      "Separate searches, shared experience. Give each career direction its own space.",
                    jobs: "Save real openings, understand the fit, and decide what deserves your time.",
                    applications:
                      "Prepare, review, follow up. Every document stays tied to the facts you used.",
                    outreach:
                      "Contacts from public sources, emails you approve, sent from your own account.",
                    sessions: "Give every research or application session a clear next action.",
                    profile: "Confirm your experience once. Reuse it across every campaign.",
                    templates:
                      "Reusable cover letters and introductions, grounded in your actual experience.",
                    assistants:
                      store?.kind === "folder"
                        ? "Continue in Codex or Claude Cowork. Their changes appear here automatically."
                        : "Continue in Codex or Claude Cowork, then bring your progress back.",
                  }[section]
                }
              </p>
            </div>
            {["overview", "campaigns"].includes(section) && (
              <Button onClick={() => openCampaign()}>＋ New campaign</Button>
            )}
            {section === "jobs" && <Button onClick={() => openJob()}>＋ Add opportunity</Button>}
            {section === "sessions" && (
              <Button onClick={() => openSession()}>＋ Start session</Button>
            )}
          </div>
          {["overview", "jobs", "applications", "outreach", "sessions"].includes(section) &&
            w.campaigns.length > 0 && (
              <div className="cd-filterbar">
                <div className="cd-filter-pills">
                  <button
                    type="button"
                    className={campaignId === "all" ? "selected" : ""}
                    onClick={() => setCampaignId("all")}
                  >
                    All campaigns
                  </button>
                  {w.campaigns.map((c) => (
                    <button
                      type="button"
                      className={campaignId === c.id ? "selected" : ""}
                      key={c.id}
                      onClick={() => setCampaignId(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <span>
                  {selectedCampaign
                    ? trackLabel[selectedCampaign.track]
                    : `${w.campaigns.length} career directions`}
                </span>
              </div>
            )}
          {section === "overview" && !w.campaigns.length && (
            <FirstRun
              w={w}
              mutate={mutate}
              local={store?.kind === "folder"}
              hasAssistant={hasAssistant}
              done={() => go("jobs")}
            />
          )}
          {section === "overview" &&
            store?.kind === "folder" &&
            w.campaigns
              .filter((c) => needsExtension(c, new Date()))
              .map((c) => (
                <ScheduleCard key={c.id} c={c} mutate={mutate} hasAssistant={hasAssistant} />
              ))}
          {section === "overview" && (
            <>
              <div className="cd-stats">
                {[
                  ["Active campaigns", w.campaigns.length, "◎", "A direction worth exploring"],
                  [
                    "Saved opportunities",
                    filteredJobs.length,
                    "▤",
                    "Possibilities, thoughtfully chosen",
                  ],
                  [
                    "Applications",
                    filteredApps.length,
                    "↗",
                    `${filteredApps.filter((a) => a.status === "prepared").length} ready for your review`,
                  ],
                  [
                    "Conversations",
                    filteredApps.filter((a) => ["interview", "offer"].includes(a.status)).length,
                    "◌",
                    "Interviews & offers",
                  ],
                ].map(([label, count, icon, note]) => (
                  <div key={label} className="cd-stat">
                    <div>
                      <span>{label}</span>
                      <i>{icon}</i>
                    </div>
                    <strong>{count}</strong>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              <div className="cd-dashboard-grid">
                <section className="cd-panel cd-start">
                  <div className="cd-panel-heading">
                    <h2>
                      {w.profile.name
                        ? `A clear path forward, ${w.profile.name.split(" ")[0]}.`
                        : "Start with you."}
                    </h2>
                    <Chip tone="green">YOUR GAME PLAN</Chip>
                  </div>
                  <p>
                    Your next chapter takes a few small steps. Build your foundation, then let your
                    assistant help with the legwork.
                  </p>
                  <div className="cd-steps">
                    {[
                      [
                        "01",
                        "Tell your story",
                        "Upload your CV and confirm your profile.",
                        "profile",
                        !!w.profile.name,
                      ],
                      [
                        "02",
                        "Choose a direction",
                        "Set up your first focused job campaign.",
                        "campaigns",
                        !!w.campaigns.length,
                      ],
                      [
                        "03",
                        "Bring in opportunities",
                        "Research with an assistant or save job links.",
                        "jobs",
                        !!w.jobs.length,
                      ],
                      [
                        "04",
                        "Make an introduction",
                        "Prepare, review, and track an application.",
                        "applications",
                        !!w.applications.length,
                      ],
                    ].map(([n, title, desc, target, done]) => (
                      <button type="button" key={String(n)} onClick={() => go(target as Section)}>
                        <span className={done ? "done" : ""}>{done ? "✓" : n}</span>
                        <div>
                          <strong>{title}</strong>
                          <small>{desc}</small>
                        </div>
                        <b>↗</b>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="cd-assistant-card">
                  <div className="cd-spark">✦</div>
                  <Chip>WORK BETTER, TOGETHER</Chip>
                  <h2>
                    Your AI assistant.
                    <br />
                    <em>Your search.</em>
                  </h2>
                  <p>
                    Take your profile, preferences, and templates to Codex or Claude Cowork. Return
                    with a shortlist and a clear next step.
                  </p>
                  <Button secondary onClick={() => go("assistants")}>
                    Set up your assistant ↗
                  </Button>
                  <span className="cd-assistant-small">You choose what it can do.</span>
                </section>
              </div>
              <div className="cd-dashboard-grid">
                <section className="cd-panel">
                  <div className="cd-panel-heading">
                    <h2>Your campaigns</h2>
                    <button
                      type="button"
                      className="cd-text-button"
                      onClick={() => go("campaigns")}
                    >
                      View all ↗
                    </button>
                  </div>
                  {!w.campaigns.length ? (
                    <Empty
                      title="A new direction starts here"
                      action={
                        <Button secondary onClick={() => openCampaign()}>
                          Create your first campaign
                        </Button>
                      }
                    >
                      Consulting, product, psychology, or something entirely your own.
                    </Empty>
                  ) : (
                    w.campaigns.slice(0, 4).map((c) => (
                      <button
                        type="button"
                        className="cd-campaign-row"
                        key={c.id}
                        onClick={() => {
                          setCampaignId(c.id);
                          go("jobs");
                        }}
                      >
                        <span className={`cd-track-icon ${c.track}`}>◎</span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>
                            {trackLabel[c.track]} · {c.locations || "Any location"}
                          </small>
                        </div>
                        <b>
                          {w.jobs.filter((j) => !j.archived && j.campaignId === c.id).length}
                          <small>saved</small>
                        </b>
                        <span>↗</span>
                      </button>
                    ))
                  )}
                </section>
                <section className="cd-panel">
                  <div className="cd-panel-heading">
                    <h2>Recent activity</h2>
                    <span className="cd-dot" />
                  </div>
                  {!w.events.length ? (
                    <div className="cd-quiet">
                      <span>◷</span>
                      <p>Room for your next steps.</p>
                      <small>Your saved work will appear here.</small>
                    </div>
                  ) : (
                    <div className="cd-timeline">
                      {w.events.slice(0, 5).map((e) => (
                        <div key={e.id}>
                          <i />
                          <div>
                            <p>{e.message}</p>
                            <small>{dateLabel(e.at)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              {filteredApps.some(
                (a) => a.followUp && a.followUp <= new Date().toLocaleDateString("en-CA"),
              ) && (
                <section className="cd-panel">
                  <h2>Follow-ups to check</h2>
                  {filteredApps
                    .filter(
                      (a) => a.followUp && a.followUp <= new Date().toLocaleDateString("en-CA"),
                    )
                    .map((a) => (
                      <button
                        type="button"
                        className="cd-campaign-row"
                        key={a.id}
                        onClick={() => showApplication(a)}
                      >
                        <strong>{w.jobs.find((j) => j.id === a.jobId)?.company}</strong>
                        <span>Due {a.followUp} ↗</span>
                      </button>
                    ))}
                </section>
              )}
            </>
          )}
          {section === "profile" && (
            <CvPdfPanel
              profile={w.profile}
              local={store?.kind === "folder"}
              build={() =>
                setModal(
                  <Modal title="Your CV" close={() => setModal(null)}>
                    <CvBuilder
                      profile={w.profile}
                      role={w.campaigns[0]?.titles.split(",")[0] ?? w.profile.headline}
                      local={store?.kind === "folder"}
                      save={async (p) => {
                        await mutate((next) => {
                          next.profile = p;
                          event(next, "Saved CV from the CV builder");
                        }, "CV saved to your profile");
                      }}
                      close={() => setModal(null)}
                    />
                  </Modal>,
                )
              }
            />
          )}
          {section === "profile" && (
            <ProfileEditor
              profile={w.profile}
              save={(p, opened) =>
                mutate((next) => {
                  next.profile = mergeProfileEdit(next.profile, opened, p);
                  event(next, "Updated verified candidate profile");
                }, "Profile saved")
              }
            />
          )}
          {section === "campaigns" &&
            (!w.campaigns.length ? (
              <section className="cd-panel">
                <Empty
                  title="Explore more than one future"
                  action={<Button onClick={() => openCampaign()}>Create a campaign</Button>}
                >
                  Each campaign has its own target roles, locations, templates, and assistant
                  permissions.
                </Empty>
              </section>
            ) : (
              <div className="cd-campaign-grid">
                {w.campaigns.map((c) => (
                  <section className="cd-panel cd-campaign-card" key={c.id}>
                    <div className="cd-panel-heading">
                      <span className={`cd-track-icon ${c.track}`}>◎</span>
                      <Chip>{trackLabel[c.track]}</Chip>
                    </div>
                    <h2>{c.name}</h2>
                    <p>{c.titles || "Target titles not set"}</p>
                    <div className="cd-campaign-meta">
                      <span>⌖ {c.locations || "Any location"}</span>
                      <span>
                        ₹{" "}
                        {c.minLpa
                          ? `${c.minLpa}${c.maxLpa ? `–${c.maxLpa}` : "+"} LPA`
                          : "Salary flexible"}
                      </span>
                      <span>✦ {modeLabel[c.mode]}</span>
                    </div>
                    <div className="cd-campaign-count">
                      <strong>
                        {w.jobs.filter((j) => !j.archived && j.campaignId === c.id).length}
                        <small>opportunities</small>
                      </strong>
                      <strong>
                        {w.applications.filter((a) => a.campaignId === c.id).length}
                        <small>applications</small>
                      </strong>
                    </div>
                    <div className="cd-card-actions">
                      <Button
                        onClick={() => {
                          setCampaignId(c.id);
                          go("jobs");
                        }}
                      >
                        Open campaign ↗
                      </Button>
                      <Button secondary onClick={() => openCampaign(c)}>
                        Edit
                      </Button>
                    </div>
                  </section>
                ))}
              </div>
            ))}
          {section === "jobs" &&
            store?.kind === "folder" &&
            w.campaigns
              .filter((c) => campaignId === "all" || c.id === campaignId)
              .slice(0, 3)
              .map((c) => (
                <ScheduleCard key={c.id} c={c} mutate={mutate} hasAssistant={hasAssistant} />
              ))}
          {section === "jobs" && store?.kind === "folder" && (
            <FindJobsPanel w={w} campaignId={campaignId} />
          )}
          {section === "jobs" && store?.kind === "folder" && (
            <JobBoardsPanel w={w} campaignId={campaignId} mutate={mutate} />
          )}
          {section === "jobs" && (
            <JobsView
              w={w}
              jobs={filteredJobs}
              selected={campaignId}
              add={() => openJob()}
              edit={openJob}
              prepare={prepare}
              mutate={mutate}
              openModal={setModal}
              local={store?.kind === "folder"}
            />
          )}
          {section === "applications" && (
            <ApplicationsView
              w={w}
              apps={filteredApps}
              open={showApplication}
              findJobs={() => go("jobs")}
            />
          )}
          {section === "sessions" && (
            <div className="cd-session-list">
              {!filteredSessions.length ? (
                <section className="cd-panel">
                  <Empty
                    icon="◷"
                    title="Every session leaves a next step"
                    action={<Button onClick={() => openSession()}>Start a work session</Button>}
                  >
                    Keep separate research and application sessions, and resume them with any
                    assistant.
                  </Empty>
                </section>
              ) : (
                filteredSessions.map((s) => (
                  <section className="cd-panel" key={s.id}>
                    <div className="cd-panel-heading">
                      <Chip tone={s.status === "active" ? "green" : ""}>
                        {s.status === "active" ? "In progress" : "Completed"}
                      </Chip>
                      <small>{dateLabel(s.updatedAt)}</small>
                    </div>
                    <h2>{s.title}</h2>
                    <p className="cd-subtle">
                      {w.campaigns.find((c) => c.id === s.campaignId)?.name} ·{" "}
                      {s.host === "cowork"
                        ? "Claude Cowork"
                        : s.host === "codex"
                          ? "Codex"
                          : "Manual / other"}
                    </p>
                    <p className="cd-prewrap">{s.notes || "No notes yet."}</p>
                    {s.nextAction && (
                      <div className="cd-next">
                        <strong>Next action</strong>
                        <p>{s.nextAction}</p>
                      </div>
                    )}
                    <Button secondary onClick={() => openSession(s)}>
                      Resume / edit session ↗
                    </Button>
                  </section>
                ))
              )}
            </div>
          )}
          {section === "outreach" && (
            <OutreachView w={w} campaignId={campaignId} mutate={mutate} openModal={setModal} />
          )}
          {section === "templates" && (
            <TemplatesView
              templates={w.templates}
              save={async (t) => {
                await mutate((next) => {
                  const at = next.templates.findIndex((v) => v.id === t.id);
                  if (at >= 0)
                    next.templates[at] = { ...t, version: must(next.templates[at]).version + 1 };
                  else next.templates.push(t);
                  event(next, `Saved template: ${t.name}`);
                }, "Template saved");
              }}
            />
          )}
          {section === "assistants" && (
            <AssistantsView w={w} mutate={mutate} store={store} liveStatus={liveStatus} />
          )}
          <footer className="cd-footer">
            <span>Made for your next chapter.</span>
            <span>
              {store?.kind === "folder"
                ? `Linked folder: ${store.location}`
                : "Saved in this browser"}{" "}
              {store?.kind === "folder" && (
                <b role="status">
                  {liveStatus === "reconnecting" ? "· ⚠ Reconnecting… " : "· ● Live "}
                </b>
              )}
              · Revision {w.revision} ·{" "}
              <button type="button" onClick={() => go("assistants")}>
                Back up your work ↗
              </button>
            </span>
          </footer>
        </main>
      </div>
      {modal}
    </div>
  );
}

function CampaignForm({
  campaign,
  templates,
  close,
  save,
}: {
  campaign?: Campaign;
  templates: Template[];
  close: () => void;
  save: (c: Campaign) => Promise<void>;
}) {
  const [c, setC] = useState<Campaign>(
    campaign ?? {
      id: uid(),
      name: "",
      track: "consulting",
      titles: "",
      locations: "",
      keywords: "",
      exclusions: "",
      minLpa: "",
      maxLpa: "",
      mode: "draft",
      templateId: templates.find((t) => t.kind === "cover")?.id ?? must(templates[0]).id,
      notes: "",
      createdAt: now(),
    },
  );
  const [busy, setBusy] = useState(false);
  const update = (k: keyof Campaign, value: string) => setC({ ...c, [k]: value });
  return (
    <Modal title={campaign ? "Edit campaign" : "A new career direction"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const valid = CampaignSchema.safeParse(c);
          if (!valid.success) {
            toast.error(valid.error.issues[0]?.message);
            return;
          }
          setBusy(true);
          await save(valid.data);
          setBusy(false);
        }}
      >
        <div className="cd-form-grid">
          <Field
            label="Campaign name"
            value={c.name}
            required
            onChange={(v) => update("name", v)}
            placeholder="Consulting · Mumbai"
          />
          <Select
            label="Career track"
            value={c.track}
            onChange={(v) => update("track", v)}
            options={TRACKS.map((v) => ({ value: v, label: trackLabel[v] ?? v }))}
          />
          <Field
            label="Target job titles"
            value={c.titles}
            onChange={(v) => update("titles", v)}
            placeholder="Consultant, Strategy Analyst"
            hint="Separate alternatives with commas"
          />
          <Field
            label="Preferred locations"
            value={c.locations}
            onChange={(v) => update("locations", v)}
            placeholder="Mumbai, Bengaluru"
            hint="Remote openings are also considered"
          />
          <Field
            label="Desired keywords"
            value={c.keywords}
            onChange={(v) => update("keywords", v)}
            placeholder="strategy, BFSI, research"
          />
          <Field
            label="Exclude terms"
            value={c.exclusions}
            onChange={(v) => update("exclusions", v)}
            placeholder="commission-only, unpaid"
          />
          <Field
            label="Minimum CTC (₹ LPA)"
            type="number"
            value={c.minLpa}
            onChange={(v) => update("minLpa", v)}
          />
          <Field
            label="Preferred upper CTC (₹ LPA)"
            type="number"
            value={c.maxLpa}
            onChange={(v) => update("maxLpa", v)}
            hint="Preference, not a hard eligibility rule"
          />
          <Select
            label="Cover-letter template"
            value={c.templateId}
            onChange={(v) => update("templateId", v)}
            options={templates
              .filter((t) => t.kind === "cover")
              .map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            label="Assistant permissions"
            value={c.mode}
            onChange={(v) => update("mode", v)}
            options={Object.entries(modeLabel).map(([value, label]) => ({ value, label }))}
          />
          <Field
            label="Search brief & constraints"
            area
            value={c.notes}
            onChange={(v) => update("notes", v)}
            placeholder="Seniority, industry, travel, full-time / part-time, relocation preferences…"
          />
        </div>
        <p className="cd-callout">
          Sending mail or submitting an application always needs a separate explicit grant in your
          assistant. This app does not send mail.
        </p>
        <div className="cd-form-actions">
          <Button secondary onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save campaign"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProfileEditor({
  profile,
  save,
}: {
  profile: Profile;
  /** `opened` is the profile as it was when the form loaded it. */
  save: (p: Profile, opened: Profile) => Promise<boolean>;
}) {
  const [p, setP] = useState<Profile>(structuredClone(profile));
  const [opened, setOpened] = useState<Profile>(() => structuredClone(profile));
  const [busy, setBusy] = useState(false);
  const update = (key: keyof Profile, v: string) => setP((prev) => ({ ...prev, [key]: v }));
  const importCv = async (file: File) => {
    setBusy(true);
    try {
      const next = await profileFromCvFile(p, file);
      setP(next);
      toast.success("CV loaded. Review the extracted details, then save your profile.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CV import failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await save(p, opened)) setOpened(structuredClone(p));
        setBusy(false);
      }}
    >
      <div className="cd-profile-grid">
        <div>
          <section className="cd-panel">
            <div className="cd-panel-heading">
              <h2>The essentials</h2>
              <Chip tone="green">REUSABLE ACROSS CAMPAIGNS</Chip>
            </div>
            <div className="cd-form-grid">
              <Field
                label="Full name"
                value={p.name}
                required
                onChange={(v) => update("name", v)}
              />
              <Field
                label="Email"
                type="email"
                value={p.email}
                required
                onChange={(v) => update("email", v)}
              />
              <Field label="Phone" value={p.phone} onChange={(v) => update("phone", v)} />
              <Field label="Current city" value={p.city} onChange={(v) => update("city", v)} />
              <Field
                label="Professional headline"
                value={p.headline}
                onChange={(v) => update("headline", v)}
                placeholder="MBA graduate · Strategy & research"
              />
              <Field
                label="Portfolio / professional link"
                value={p.portfolio}
                onChange={(v) => update("portfolio", v)}
              />
              <Field
                label="Experience summary"
                area
                value={p.summary}
                onChange={(v) => update("summary", v)}
                hint="Use facts and outcomes you can substantiate. These appear in your drafts."
              />
              <Field
                label="Skills"
                area
                value={p.skills}
                onChange={(v) => update("skills", v)}
                placeholder="Customer research, Financial modelling, SQL"
              />
              <Field
                label="Qualifications & education"
                area
                value={p.qualifications}
                onChange={(v) => update("qualifications", v)}
              />
            </div>
          </section>
          <section className="cd-panel">
            <h2>Preferences & professional details</h2>
            <div className="cd-form-grid">
              <Field
                label="Experience (years)"
                type="number"
                value={p.experienceYears}
                onChange={(v) => update("experienceYears", v)}
              />
              <Field
                label="Notice period (days)"
                type="number"
                value={p.noticeDays}
                onChange={(v) => update("noticeDays", v)}
              />
              <Field
                label="Current CTC (₹ LPA, optional)"
                type="number"
                value={p.currentLpa}
                onChange={(v) => update("currentLpa", v)}
              />
              <Field
                label="Expected CTC (₹ LPA)"
                type="number"
                value={p.expectedLpa}
                onChange={(v) => update("expectedLpa", v)}
              />
              <Field
                label="Languages"
                value={p.languages}
                onChange={(v) => update("languages", v)}
                placeholder="English, Hindi, Tamil"
              />
              <Field
                label="Verified registrations / credentials"
                value={p.credentials}
                onChange={(v) => update("credentials", v)}
                hint="Comma-separated, e.g. RCI. Enter only credentials you hold."
              />
              <Field
                label="CV text / verified work history"
                area
                value={p.resumeText}
                onChange={(v) => update("resumeText", v)}
                hint="This text is preserved in application snapshots. Review extraction for missing dates or sections."
              />
            </div>
          </section>
        </div>
        <aside>
          <section className="cd-panel cd-upload">
            <div className="cd-upload-icon">↥</div>
            <h2>Begin with your CV</h2>
            <p>
              Import a PDF, LaTeX, or text file. Extraction runs on your device. Confirm the details
              before saving.
            </p>
            <label className="cd-button secondary cd-upload-label">
              {busy ? "Reading CV…" : "Choose CV file"}
              <input
                type="file"
                accept=".pdf,.tex,.txt"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importCv(f);
                  e.target.value = "";
                }}
              />
            </label>
            <small>PDF, .tex, .txt · up to 5 MB</small>
            {p.resumeFile && (
              <div className="cd-file-chip">
                <strong>▧ {p.resumeFile.name}</strong>
                <button
                  type="button"
                  onClick={() => setP({ ...p, resumeFile: undefined, resumeDoc: undefined })}
                  aria-label="Remove attached CV"
                >
                  ×
                </button>
              </div>
            )}
          </section>
          <section className="cd-profile-note">
            <span>✳</span>
            <h3>One source of truth.</h3>
            <p>
              Assistants work from the facts you confirm here. Missing information stays missing.
            </p>
            <p>
              Your existing application documents remain unchanged when you update your profile.
            </p>
          </section>
        </aside>
      </div>
      <div className="cd-sticky-actions">
        <span>Stored in this browser. Export a backup to keep a copy.</span>
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

function JobForm({
  job,
  campaigns,
  selected,
  close,
  save,
}: {
  job?: Job;
  campaigns: Campaign[];
  selected: string;
  close: () => void;
  save: (j: JobInput) => Promise<void>;
}) {
  const [j, setJ] = useState<JobInput>(
    job ?? {
      campaignId: selected !== "all" ? selected : must(campaigns[0]).id,
      company: "",
      title: "",
      url: "",
      location: "",
      description: "",
      salaryLpa: "",
      minExperience: "",
      requiredCredentials: "",
      requiredLanguages: "",
      notes: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const update = (k: keyof JobInput, value: string) => setJ({ ...j, [k]: value });
  return (
    <Modal title={job ? "Edit opportunity" : "Save an opportunity"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await save(j);
          setBusy(false);
        }}
      >
        <div className="cd-form-grid">
          <Field label="Job title" required value={j.title} onChange={(v) => update("title", v)} />
          <Field
            label="Company / organisation"
            required
            value={j.company}
            onChange={(v) => update("company", v)}
          />
          <Field
            label="Job URL"
            required
            type="url"
            value={j.url}
            onChange={(v) => update("url", v)}
          />
          <Select
            label="Campaign"
            value={j.campaignId}
            onChange={(v) => update("campaignId", v)}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Field
            label="Location / work mode"
            value={j.location}
            onChange={(v) => update("location", v)}
            placeholder="Mumbai · Hybrid"
          />
          <Field
            label="Listed annual CTC (₹ LPA)"
            type="number"
            value={j.salaryLpa}
            onChange={(v) => update("salaryLpa", v)}
            hint="Leave blank if unknown. Do not enter monthly or per-session pay here."
          />
          <Field
            label="Minimum experience (years)"
            type="number"
            value={j.minExperience}
            onChange={(v) => update("minExperience", v)}
          />
          <Field
            label="Required languages"
            value={j.requiredLanguages}
            onChange={(v) => update("requiredLanguages", v)}
            hint="Comma-separated mandatory requirements"
          />
          <Field
            label="Required credentials"
            value={j.requiredCredentials}
            onChange={(v) => update("requiredCredentials", v)}
            placeholder="RCI"
          />
          <Field
            label="Notes / original compensation terms"
            value={j.notes}
            onChange={(v) => update("notes", v)}
          />
          <Field
            label="Full job description"
            area
            value={j.description}
            onChange={(v) => update("description", v)}
          />
        </div>
        <div className="cd-form-actions">
          <Button secondary onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save opportunity"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Mutate = (fn: (w: Workspace) => void, message?: string) => Promise<boolean>;
function JobsView({
  w,
  jobs,
  selected,
  add,
  edit,
  prepare,
  mutate,
  openModal,
  local,
}: {
  w: Workspace;
  jobs: Job[];
  local: boolean;
  selected: string;
  add: () => void;
  edit: (j: Job) => void;
  prepare: (j: Job) => Promise<void>;
  mutate: Mutate;
  openModal: (content: ReactNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("fit");
  const importJobs = async (file: File) => {
    if (!w.campaigns.length) {
      toast.error("Create a campaign before importing jobs");
      return;
    }
    try {
      if (file.size > 5_000_000) throw new Error("Job import must be under 5 MB");
      const content = await file.text();
      const rows = file.name.toLowerCase().endsWith(".csv")
        ? parseCsv(content)
        : JSON.parse(content);
      if (!Array.isArray(rows) || rows.length > 500)
        throw new Error("Import an array of up to 500 jobs");
      const imported: JobInput[] = rows.map((row: Record<string, unknown>) => ({
        campaignId: selected === "all" ? must(w.campaigns[0]).id : selected,
        company: String(row.company ?? ""),
        title: String(row.title ?? ""),
        url: String(row.url ?? row.job_url ?? ""),
        location: String(row.location ?? ""),
        description: String(row.description ?? ""),
        salaryLpa: String(row.salaryLpa ?? ""),
        minExperience: String(row.minExperience ?? ""),
        requiredCredentials: String(row.requiredCredentials ?? ""),
        requiredLanguages: String(row.requiredLanguages ?? ""),
        notes: String(row.notes ?? ""),
      }));
      openModal(
        <Modal title="Review job import" close={() => openModal(null)}>
          <p className="cd-subtle">
            {imported.length} rows →{" "}
            {w.campaigns.find((c) => c.id === imported[0]?.campaignId)?.name}. The whole import is
            validated before saving. Existing job links are skipped.
          </p>
          <div className="cd-import-list">
            {imported.slice(0, 30).map((j) => (
              <p key={`${j.url}-${j.title}-${j.company}`}>
                <strong>{j.title || "Missing title"}</strong> · {j.company || "Missing company"}
                <small>{j.url}</small>
              </p>
            ))}
          </div>
          <div className="cd-form-actions">
            <Button secondary onClick={() => openModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void (async () => {
                  let added = 0;
                  let skipped = 0;
                  const ok = await mutate((next) => {
                    for (const row of imported) {
                      try {
                        addJob(next, row);
                        added++;
                      } catch (e) {
                        if (e instanceof Error && /already saved/.test(e.message)) skipped++;
                        else throw e;
                      }
                    }
                  }, "");
                  if (ok) {
                    toast.success(`Imported ${added} jobs; skipped ${skipped} duplicates`);
                    openModal(null);
                  }
                })();
              }}
            >
              Import opportunities
            </Button>
          </div>
        </Modal>,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };
  const corpus = jobCorpus(w);
  const visible = jobs
    .filter((j) =>
      `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(query.toLowerCase()),
    )
    .map((j) => ({
      j,
      fit: matchJob(w.profile, must(w.campaigns.find((c) => c.id === j.campaignId)), j, corpus),
    }))
    .sort((a, b) =>
      sort === "fit" ? b.fit.score - a.fit.score : b.j.createdAt.localeCompare(a.j.createdAt),
    );
  const searchCampaign = w.campaigns.find((c) => c.id === selected) ?? w.campaigns[0];
  return (
    <>
      <div className="cd-toolbar">
        <input
          aria-label="Search saved opportunities"
          placeholder="Search role, company, or location…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Sort opportunities"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="fit">Best match first</option>
          <option value="recent">Recently saved</option>
        </select>
        <label className="cd-button secondary cd-upload-label">
          Import CSV / JSON
          <input
            type="file"
            accept=".csv,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJobs(file);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="cd-text-button"
          type="button"
          onClick={() =>
            downloadFile(
              "job-import-template.csv",
              "title,company,url,location,description,salaryLpa,minExperience,requiredCredentials,requiredLanguages,notes\n",
              "text/csv",
            )
          }
        >
          CSV template ↧
        </button>
      </div>
      {searchCampaign && (
        <div className="cd-source-strip">
          <span>Explore openings ↗</span>
          {searchLinks(searchCampaign).map((s) => (
            <a key={s.label} href={s.url} target="_blank" rel="noreferrer">
              {s.label} ↗
            </a>
          ))}
          <small>Opens a web search. Save verified links or research with your assistant.</small>
        </div>
      )}
      {!visible.length ? (
        <section className="cd-panel">
          <Empty
            icon="▤"
            title={
              query ? "No opportunities match this search" : "A shortlist worth your attention"
            }
            action={<Button onClick={add}>Add an opportunity</Button>}
          >
            {query
              ? "Try another role, company, or location."
              : "Save a job link and description, import a list, or let your assistant help with research."}
          </Empty>
        </section>
      ) : (
        <div className="cd-job-grid">
          {visible.map(({ j, fit }) => {
            const app = w.applications.find((a) => a.jobId === j.id);
            return (
              <article className="cd-panel cd-job-card" key={j.id}>
                <div className="cd-panel-heading">
                  <div className="cd-company-avatar">{j.company.slice(0, 2).toUpperCase()}</div>
                  <Chip tone={fit.score >= 70 ? "green" : ""}>
                    {fit.score}% match{fit.eligible ? "" : " · check"}
                  </Chip>
                </div>
                <small className="cd-subtle">{j.company}</small>
                <h2>{j.title}</h2>
                <div className="cd-job-meta">
                  <span>⌖ {j.location || "Location unknown"}</span>
                  <span>{j.salaryLpa ? `₹${j.salaryLpa} LPA` : "Salary not listed"}</span>
                </div>
                <div className="cd-job-tags">
                  <Chip>{w.campaigns.find((c) => c.id === j.campaignId)?.name}</Chip>
                  {app && <Chip tone="green">{statusLabel[app.status]}</Chip>}
                </div>
                <p className="cd-job-desc">
                  {j.description
                    ? plainText(j.description)
                    : "Add the full description to improve matching."}
                </p>
                {j.description.length > 280 && (
                  <details className="cd-fit">
                    <summary>Full description</summary>
                    <div className="cd-job-full">{plainText(j.description)}</div>
                  </details>
                )}
                <details className="cd-fit">
                  <summary>
                    Why this match?{" "}
                    <span>
                      {fit.warnings.length
                        ? `${fit.warnings.length} to review`
                        : "Preferences checked"}
                    </span>
                  </summary>
                  <p>
                    Skills, CV similarity and your campaign preferences, scored without AI. Not
                    hiring probability or verified eligibility.
                  </p>
                  {Object.keys(fit.breakdown).length > 0 && (
                    <div className="cd-subtle">
                      {Object.entries(fit.breakdown)
                        .map(([k, v]) => `${k} ${v}%`)
                        .join(" · ")}
                    </div>
                  )}
                  {fit.reasons.map((s) => (
                    <div className="cd-reason" key={s}>
                      ✓ {s}
                    </div>
                  ))}
                  {fit.warnings.map((s) => (
                    <div className="cd-warning" key={s}>
                      △ {s}
                    </div>
                  ))}
                  {fit.keywordsToAdd.length > 0 && (
                    <div className="cd-subtle">
                      Add to your CV only if true: {fit.keywordsToAdd.join(", ")}
                    </div>
                  )}
                </details>
                <div className="cd-job-verify">
                  <span>
                    {j.verifiedAt
                      ? `Checked ${dateLabel(j.verifiedAt)}`
                      : "Opening not yet verified"}
                  </span>
                  <button
                    type="button"
                    className="cd-text-button"
                    onClick={() =>
                      void mutate((next) => {
                        must(next.jobs.find((v) => v.id === j.id)).verifiedAt = now();
                        event(next, `User verified opening: ${j.company}`);
                      }, "Recorded your verification")
                    }
                  >
                    I checked it ✓
                  </button>
                </div>
                <div className="cd-card-actions">
                  <Button onClick={() => void prepare(j)}>
                    {app ? "View application" : "Prepare application"} ↗
                  </Button>
                  <Button secondary onClick={() => edit(j)}>
                    Edit
                  </Button>
                  {local && (
                    <Button
                      secondary
                      onClick={() =>
                        void downloadCvPdf(
                          resumeToRenderCv(profileToResume(w.profile), { match: fit }),
                          `${w.profile.name || "CV"} - ${j.company}`,
                        )
                      }
                    >
                      Tailored CV PDF
                    </Button>
                  )}
                  {local && (
                    <Button
                      secondary
                      onClick={() =>
                        openModal(
                          <Modal
                            title={`Recruiter email · ${j.company}`}
                            close={() => openModal(null)}
                          >
                            <FindContacts job={j} mutate={mutate} />
                          </Modal>,
                        )
                      }
                    >
                      Find recruiter email
                    </Button>
                  )}
                  <a
                    className="cd-icon-button"
                    href={j.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${j.company} job`}
                  >
                    ↗
                  </a>
                  <button
                    type="button"
                    className="cd-text-button"
                    onClick={() =>
                      void mutate((next) => {
                        must(next.jobs.find((v) => v.id === j.id)).archived = true;
                        event(next, `Archived opportunity: ${j.company}`);
                      }, "Opportunity archived; application history retained")
                    }
                  >
                    Archive
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {w.jobs.some((j) => j.archived && (selected === "all" || j.campaignId === selected)) && (
        <details className="cd-panel">
          <summary>Archived opportunities</summary>
          {w.jobs
            .filter((j) => j.archived && (selected === "all" || j.campaignId === selected))
            .map((j) => (
              <div className="cd-campaign-row" key={j.id}>
                <span>
                  {j.title} · {j.company}
                </span>
                <Button
                  secondary
                  onClick={() =>
                    void mutate((next) => {
                      must(next.jobs.find((v) => v.id === j.id)).archived = false;
                    }, "Opportunity restored")
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
        </details>
      )}
    </>
  );
}

function ApplicationsView({
  w,
  apps,
  open,
  findJobs,
}: {
  w: Workspace;
  apps: Application[];
  open: (a: Application) => void;
  findJobs: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const filtered = apps.filter((a) => filter === "all" || a.status === filter);
  return (
    <>
      <div className="cd-status-filters">
        <button
          type="button"
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          All <b>{apps.length}</b>
        </button>
        {STATUSES.map((s) => (
          <button
            type="button"
            className={filter === s ? "selected" : ""}
            key={s}
            onClick={() => setFilter(s)}
          >
            {statusLabel[s]} <b>{apps.filter((a) => a.status === s).length}</b>
          </button>
        ))}
      </div>
      <section className="cd-panel">
        {!filtered.length ? (
          <Empty
            icon="↗"
            title="Give your next application a head start"
            action={<Button onClick={findJobs}>Browse saved opportunities</Button>}
          >
            Prepare a cover letter and introduction from a saved job. Nothing is submitted
            automatically.
          </Empty>
        ) : (
          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Follow-up</th>
                  <th>Updated</th>
                  <th>
                    <span className="cd-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const j = must(w.jobs.find((v) => v.id === a.jobId));
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{j.title}</strong>
                        <small>{j.company}</small>
                      </td>
                      <td>{w.campaigns.find((c) => c.id === a.campaignId)?.name}</td>
                      <td>
                        <Chip tone={["interview", "offer"].includes(a.status) ? "green" : ""}>
                          {statusLabel[a.status]}
                        </Chip>
                      </td>
                      <td>{a.followUp || "—"}</td>
                      <td>{dateLabel(a.updatedAt)}</td>
                      <td>
                        <Button secondary onClick={() => open(a)}>
                          Review ↗
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ApplicationEditor({
  app,
  attachment,
  job,
  close,
  save,
  approveFill,
  profile,
}: {
  app: Application;
  attachment?: Workspace["attachments"][number];
  job: Job;
  close: () => void;
  save: (a: Application) => Promise<void>;
  approveFill: (value: boolean) => Promise<void>;
  profile: Profile;
}) {
  const [a, setA] = useState(structuredClone(app));
  const [tab, setTab] = useState("coverLetter");
  const [busy, setBusy] = useState(false);
  const text = a[tab as "coverLetter" | "outreach" | "resume"];
  return (
    <Modal title={`${job.company} · ${job.title}`} close={close}>
      <p className="cd-callout">
        Drafts use your saved facts and template version {a.templateVersion}. Review placeholders
        and wording. No application or email has been sent by this app.
      </p>
      {app.status === "prepared" && (
        <div className="cd-callout">
          <strong>Assisted applying.</strong>{" "}
          {app.fillApprovedAt
            ? `Approved ${dateLabel(app.fillApprovedAt)}. Your assistant may fill this employer's form with these documents and must stop before Submit.`
            : "Approve when the documents are final. Your assistant can then fill the employer's form; you review and press Submit yourself."}{" "}
          <Button secondary onClick={() => void approveFill(!app.fillApprovedAt)}>
            {app.fillApprovedAt ? "Withdraw approval" : "Approve form filling"}
          </Button>
        </div>
      )}
      <div className="cd-doc-tabs">
        {[
          ["coverLetter", "Cover letter"],
          ["outreach", "Email introduction"],
          ["resume", "CV text"],
        ].map(([id, label]) => (
          <button
            type="button"
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(must(id))}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== "resume" && (
        <ClaimList warnings={checkClaims(profile, text, { company: job.company })} />
      )}
      <textarea
        aria-label="Application document"
        className="cd-document-editor"
        value={text}
        onChange={(e) => setA({ ...a, [tab]: e.target.value })}
        maxLength={100_000}
      />
      <div className="cd-document-actions">
        <Button
          secondary
          onClick={() => {
            try {
              printDocument(`${job.company} · ${job.title}`, text);
            } catch (e) {
              toast.error(String(e));
            }
          }}
        >
          Print / PDF ↗
        </Button>
        <Button secondary onClick={() => downloadFile(`${slug(job.company)}-${tab}.txt`, text)}>
          Download text ↧
        </Button>
        <Button
          secondary
          onClick={() => {
            void navigator.clipboard.writeText(text).then(
              () => toast.success("Copied"),
              () => toast.error("Clipboard unavailable. Download the text instead."),
            );
          }}
        >
          Copy text
        </Button>
        <a className="cd-button secondary" href={job.url} target="_blank" rel="noreferrer">
          Open application ↗
        </a>
        {tab === "outreach" && (
          <a
            className="cd-button secondary"
            href={`mailto:?subject=${encodeURIComponent(`Application: ${job.title}`)}&body=${encodeURIComponent(a.outreach)}`}
          >
            Open email draft ↗
          </a>
        )}
      </div>
      {(attachment || a.profileSnapshot.resumeFile) && (
        <button
          type="button"
          className="cd-text-button"
          onClick={() => {
            const f = attachment || a.profileSnapshot.resumeFile;
            if (!f) return;
            downloadFile(
              f.name,
              Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)),
              f.mime,
            );
          }}
        >
          Download original CV: {attachment?.name || a.profileSnapshot.resumeFile?.name} ↧
        </button>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await save(a);
          setBusy(false);
        }}
      >
        <div className="cd-form-grid cd-form-separated">
          <Select
            label="Application status"
            value={a.status}
            onChange={(v) => setA({ ...a, status: v as Application["status"] })}
            options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] ?? s }))}
          />
          <Field
            label="Follow-up date"
            type="date"
            value={a.followUp}
            onChange={(v) => setA({ ...a, followUp: v })}
          />
          <Field
            label="Confirmation / outcome reference"
            area
            value={a.evidence}
            onChange={(v) => setA({ ...a, evidence: v })}
            hint="Required for applied, interview, offer, or rejection. Record what actually happened."
          />
          <Field
            label="Application notes"
            area
            value={a.notes}
            onChange={(v) => setA({ ...a, notes: v })}
          />
        </div>
        <div className="cd-form-actions">
          <Button secondary onClick={close}>
            Close
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save application"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SessionForm({
  session,
  campaigns,
  selected,
  close,
  save,
}: {
  session?: Session;
  campaigns: Campaign[];
  selected: string;
  close: () => void;
  save: (s: Session) => Promise<void>;
}) {
  const [s, setS] = useState<Session>(
    session ?? {
      id: uid(),
      campaignId: selected === "all" ? must(campaigns[0]).id : selected,
      title: "",
      host: "manual",
      status: "active",
      notes: "",
      nextAction: "",
      createdAt: now(),
      updatedAt: now(),
    },
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={session ? "Continue work session" : "Start a work session"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await save({ ...s, updatedAt: now() });
          setBusy(false);
        }}
      >
        <div className="cd-form-grid">
          <Field
            label="Session title"
            required
            value={s.title}
            onChange={(v) => setS({ ...s, title: v })}
            placeholder="Research boutique consulting firms"
          />
          <Select
            label="Campaign"
            value={s.campaignId}
            onChange={(v) => setS({ ...s, campaignId: v })}
            options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            label="Working with"
            value={s.host}
            onChange={(v) => setS({ ...s, host: v as Session["host"] })}
            options={[
              { value: "manual", label: "By myself" },
              { value: "codex", label: "Codex" },
              { value: "cowork", label: "Claude Cowork" },
              { value: "other", label: "Another assistant" },
            ]}
          />
          <Select
            label="Session status"
            value={s.status}
            onChange={(v) => setS({ ...s, status: v as Session["status"] })}
            options={[
              { value: "active", label: "In progress" },
              { value: "completed", label: "Completed" },
            ]}
          />
          <Field
            label="Progress & findings"
            area
            value={s.notes}
            onChange={(v) => setS({ ...s, notes: v })}
          />
          <Field
            label="Next action"
            area
            value={s.nextAction}
            onChange={(v) => setS({ ...s, nextAction: v })}
            hint="A specific step you or your assistant can resume."
          />
        </div>
        <div className="cd-form-actions">
          <Button secondary onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save session
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TemplatesView({
  templates,
  save,
}: {
  templates: Template[];
  save: (t: Template) => Promise<void>;
}) {
  const [active, setActive] = useState(must(templates[0]).id);
  const [draft, setDraft] = useState<Template>(structuredClone(must(templates[0])));
  const [busy, setBusy] = useState(false);
  const variables = [
    "name",
    "email",
    "phone",
    "headline",
    "summary",
    "skills",
    "qualifications",
    "city",
    "languages",
    "credentials",
    "portfolio",
    "role",
    "company",
    "location",
  ];
  const choose = (t: Template) => {
    setActive(t.id);
    setDraft(structuredClone(t));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      renderTemplate(draft.body, Object.fromEntries(variables.map((v) => [v, v])));
      setBusy(true);
      // Saving here means the user wrote or checked these words.
      await save({ ...draft, reviewedAt: now() });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid template");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cd-template-grid">
      <aside className="cd-panel">
        <h2>Your collection</h2>
        {templates.map((t) => (
          <button
            type="button"
            className={`cd-template-item ${active === t.id ? "selected" : ""}`}
            key={t.id}
            onClick={() => choose(t)}
          >
            <span>▧</span>
            <div>
              <strong>{t.name}</strong>
              <small>
                {t.kind === "cover" ? "Cover letter" : "Email introduction"} · v{t.version}
                {t.reviewedAt ? "" : " · starter, not yet yours"}
              </small>
            </div>
          </button>
        ))}
        <Button
          secondary
          onClick={() =>
            choose({
              id: uid(),
              name: "",
              kind: "cover",
              body: "Dear Hiring Team,\n\nI am applying for {{role}} at {{company}}.\n\n{{summary}}\n\n{{name}}",
              version: 1,
              reviewedAt: "",
            })
          }
        >
          ＋ New template
        </Button>
        <label className="cd-text-button cd-upload-label">
          Import text template ↥
          <input
            type="file"
            accept=".txt,.md"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 100_000) toast.error("Template must be under 100 KB");
                else
                  void f.text().then((body) =>
                    choose({
                      id: uid(),
                      name: f.name.replace(/\.[^.]+$/, ""),
                      kind: "cover",
                      body,
                      version: 1,
                      reviewedAt: "",
                    }),
                  );
              }
              e.target.value = "";
            }}
          />
        </label>
      </aside>
      <form className="cd-panel" onSubmit={(e) => void submit(e)}>
        <h2>Make it sound like you</h2>
        <div className="cd-form-grid">
          <Field
            label="Template name"
            required
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v })}
          />
          <Select
            label="Template type"
            value={draft.kind}
            onChange={(v) => setDraft({ ...draft, kind: v as Template["kind"] })}
            options={[
              { value: "cover", label: "Cover letter" },
              { value: "outreach", label: "Email introduction" },
            ]}
          />
        </div>
        <Field
          label="Template text"
          area
          value={draft.body}
          onChange={(v) => setDraft({ ...draft, body: v })}
        />
        <div className="cd-variables">
          <strong>Insert a field</strong>
          {variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setDraft({ ...draft, body: `${draft.body}{{${v}}}` })}
            >{`{{${v}}}`}</button>
          ))}
        </div>
        <p className="cd-callout">
          Blank profile fields become visible [Add …] placeholders. New template versions affect
          future applications; saved documents keep their original text. Emails are only drafted
          from a template you have saved here, because you are the one sending them.
        </p>
        <div className="cd-form-actions">
          <Button secondary onClick={() => downloadFile(`${slug(draft.name)}.txt`, draft.body)}>
            Download template
          </Button>
          <Button type="submit" disabled={busy}>
            {draft.reviewedAt ? "Save template" : "Save as my wording"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function AssistantsView({
  w,
  mutate,
  store,
  liveStatus,
}: {
  w: Workspace;
  mutate: Mutate;
  store: WorkspaceStore | null;
  liveStatus: LiveStatus | null;
}) {
  const linked = store?.kind === "folder";
  const folderPrompt = `Read ASSISTANT.md in this folder, then help me continue the campaign I select. workspace.json here is linked to my Career Desk app: edit it in place and the app updates live. Review my preferences, latest session, and known gaps first. Research real openings and prepare drafts within my permissions. Never invent facts or send anything without my explicit authorization.`;
  const [pending, setPending] = useState<Workspace | null>(null);
  const [restore, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const prompt = `Read ASSISTANT.md and workspace.json in this folder. Help me continue the campaign I select. Review my preferences, latest session, and known gaps first. Research real openings and prepare drafts within my permissions. Never invent facts or send anything without my explicit authorization. Return the complete updated workspace.json with an incremented revision.`;
  const onImport = async (file: File) => {
    try {
      const value = readWorkspaceFile(new Uint8Array(await file.arrayBuffer()), file.name);
      setPending(value);
      setRestore(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };
  return (
    <>
      {linked && <ConnectionsPanel liveStatus={liveStatus} />}
      {linked && store && (
        <section className="cd-panel">
          <div className="cd-panel-heading">
            <h2>Linked workspace folder</h2>
            <Chip tone="green">LIVE · NO IMPORT NEEDED</Chip>
          </div>
          <p className="cd-subtle">
            Career Desk saves to <code>{store.location}</code>. Open this folder in Codex or give
            Cowork access to it. When the assistant edits <code>workspace.json</code>, this page
            updates automatically. If you both change it at once, the app keeps the assistant's
            version and asks you to redo your last edit.
          </p>
          <div className="cd-export-actions">
            <Button
              secondary
              onClick={() =>
                void navigator.clipboard.writeText(store.location).then(
                  () => toast.success("Folder path copied"),
                  () => toast.error("Select and copy the path manually"),
                )
              }
            >
              Copy folder path
            </Button>
            <Button secondary onClick={() => downloadFile("ASSISTANT.md", FOLDER_GUIDE)}>
              Download instructions
            </Button>
          </div>
          <div className="cd-prompt">
            <div>
              <strong>Starter prompt</strong>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(folderPrompt).then(
                    () => toast.success("Prompt copied"),
                    () => toast.error("Select and copy the prompt manually"),
                  )
                }
              >
                Copy ↗
              </button>
            </div>
            <p>{folderPrompt}</p>
          </div>
        </section>
      )}
      <div className="cd-assistant-grid">
        {[
          [
            "Codex",
            "C",
            "Open the extracted folder as a project in Codex, then paste the starter prompt.",
          ],
          [
            "Claude Cowork",
            "✳",
            "Give Cowork access to the extracted folder, then paste the starter prompt.",
          ],
        ].map(([name, icon, desc]) => (
          <section className="cd-panel" key={name}>
            <div className="cd-panel-heading">
              <span className="cd-host-icon">{icon}</span>
              <Chip>FOLDER HANDOFF</Chip>
            </div>
            <h2>{name}</h2>
            <p>{desc}</p>
            <ol className="cd-connection-steps">
              <li>Export and extract your workspace ZIP.</li>
              <li>Open or grant access to that folder.</li>
              <li>Choose a campaign and begin a session.</li>
              <li>Import the updated workspace.json here.</li>
            </ol>
          </section>
        ))}
      </div>
      <section className="cd-panel">
        <div className="cd-panel-heading">
          <h2>Take your workspace with you</h2>
          <Chip tone="green">NO ACCOUNT REQUIRED</Chip>
        </div>
        <p className="cd-subtle">
          Includes your profile, CV, campaigns, templates, applications, sessions, a JSON schema,
          and assistant workflow instructions. This is a manual handoff, not a live account
          connection.
        </p>
        <div className="cd-export-actions">
          <Button
            onClick={() => {
              try {
                downloadFile(
                  "career-desk-workspace.zip",
                  workspaceZip(w, z.toJSONSchema(WorkspaceSchema)),
                  "application/zip",
                );
                toast.success("Workspace exported. Store it privately; it contains personal data.");
              } catch (e) {
                toast.error(String(e));
              }
            }}
          >
            Export assistant workspace ↧
          </Button>
          <Button
            secondary
            onClick={() =>
              downloadFile("workspace.json", JSON.stringify(w, null, 2), "application/json")
            }
          >
            Download JSON backup
          </Button>
          <Button secondary onClick={() => downloadFile("ASSISTANT.md", ASSISTANT_GUIDE)}>
            Download instructions
          </Button>
        </div>
        <div className="cd-prompt">
          <div>
            <strong>Starter prompt</strong>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(prompt).then(
                  () => toast.success("Prompt copied"),
                  () => toast.error("Select and copy the prompt manually"),
                )
              }
            >
              Copy ↗
            </button>
          </div>
          <p>{prompt}</p>
        </div>
      </section>
      <section className="cd-panel">
        <h2>Bring your progress back</h2>
        <p className="cd-subtle">
          Import an updated workspace.json or a backup ZIP. You will review the incoming version
          before anything changes.
        </p>
        <label className="cd-button secondary cd-upload-label">
          Choose workspace file ↥
          <input
            type="file"
            accept=".json,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
        </label>
        {pending && (
          <div className="cd-import-review">
            <h3>Review incoming workspace</h3>
            <div className="cd-form-grid">
              <div>
                <strong>Current</strong>
                <p>
                  Revision {w.revision} · {w.jobs.length} jobs · {w.applications.length}{" "}
                  applications
                </p>
              </div>
              <div>
                <strong>Incoming</strong>
                <p>
                  Revision {pending.revision} · {pending.jobs.length} jobs ·{" "}
                  {pending.applications.length} applications
                </p>
                <small>
                  {dateLabel(pending.updatedAt)} · {pending.profile.name || "Unnamed profile"}
                </small>
              </div>
            </div>
            <p className="cd-callout">
              Import replaces the current workspace after validation. Export a backup first. Review
              document text, status changes, and any removed records.
            </p>
            <details>
              <summary>Inspect incoming changes</summary>
              <pre className="cd-json-review">
                {JSON.stringify(
                  {
                    profile: {
                      ...pending.profile,
                      resumeDoc: undefined,
                      resumeFile: pending.profile.resumeFile?.name,
                    },
                    campaigns: pending.campaigns.map((c) => ({ name: c.name, mode: c.mode })),
                    applications: pending.applications.map((a) => ({
                      job: pending.jobs.find((j) => j.id === a.jobId)?.title,
                      status: a.status,
                      evidence: a.evidence,
                      notes: a.notes,
                      coverLetter: a.coverLetter,
                      outreach: a.outreach,
                      resume: a.resume,
                    })),
                    jobs: pending.jobs.map((j) => ({
                      title: j.title,
                      company: j.company,
                      url: j.url,
                      requiredCredentials: j.requiredCredentials,
                      requiredLanguages: j.requiredLanguages,
                    })),
                    sessions: pending.sessions.map((s) => ({
                      title: s.title,
                      nextAction: s.nextAction,
                    })),
                    removedJobs: w.jobs
                      .filter((j) => !pending.jobs.some((v) => v.id === j.id))
                      .map((j) => j.title),
                    removedApplications: w.applications
                      .filter((a) => !pending.applications.some((v) => v.id === a.id))
                      .map((a) => w.jobs.find((j) => j.id === a.jobId)?.title),
                    removedCampaigns: w.campaigns
                      .filter((c) => !pending.campaigns.some((v) => v.id === c.id))
                      .map((c) => c.name),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
            <label className="cd-check">
              <input
                type="checkbox"
                checked={restore}
                onChange={(e) => setRestore(e.target.checked)}
              />
              Restore backup / replace a different or older workspace
            </label>
            <div className="cd-form-actions">
              <Button secondary onClick={() => setPending(null)}>
                Cancel import
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    const ok = await mutate((next) => {
                      const incoming = importWorkspace(next, pending, restore);
                      Object.assign(next, incoming);
                      event(next, "Imported reviewed workspace changes");
                    }, "Workspace imported");
                    if (ok) setPending(null);
                    setBusy(false);
                  })();
                }}
              >
                Confirm import
              </Button>
            </div>
          </div>
        )}
      </section>
      <section className="cd-privacy-note">
        <span>◇</span>
        <div>
          <h3>Connected by choice.</h3>
          <p>
            {linked
              ? "Your workspace is a file in the linked folder on this PC. "
              : "Your workspace stays in this browser until you export it. "}
            Giving a folder to an assistant shares its contents with that provider. Mail access, web
            access, scheduling, and external actions depend on the assistant's available tools and
            your separate authorization. No passwords or login cookies are included.
          </p>
          <p>
            {linked
              ? "Run one assistant session on the folder at a time. Keep regular backups of the folder."
              : "One writer per exported revision. Finish and import one assistant session before starting another. Export regular backups: clearing browser storage removes your local copy."}
          </p>
        </div>
      </section>
    </>
  );
}

const outreachLabel: Record<string, string> = {
  draft: "Needs your approval",
  approved: "Approved · waiting to send",
  sending: "Being sent · confirm the outcome",
  sent: "Sent",
  failed: "Not sent",
  unknown: "Unconfirmed · check your Sent folder",
  rejected: "Rejected",
};

function OutreachView({
  w,
  campaignId,
  mutate,
  openModal,
}: {
  w: Workspace;
  campaignId: string;
  mutate: Mutate;
  openModal: (node: ReactNode) => void;
}) {
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set());
  const inCampaign = (id: string) => campaignId === "all" || id === campaignId;
  const contacts = w.contacts.filter((c) => inCampaign(c.campaignId));
  const emails = w.outreach.filter((o) => inCampaign(o.campaignId));
  const queue = sendQueue(w);
  const close = () => openModal(null);
  // Downloading claims the email for you, so no assistant can send it as well.
  const download = async (o: Workspace["outreach"][number]) => {
    const c = w.contacts.find((v) => v.id === o.contactId);
    const eml = emlFor(w, o);
    const ok = await mutate((next) => void claimSend(next, o.id, "you (email file)"), "");
    if (!ok) return;
    downloadFile(`${slug(c?.company ?? "email")}-email.eml`, eml, "message/rfc822");
    toast.success(
      "Email file downloaded. Open it in Outlook or Thunderbird, check it and press Send once. Then confirm it here.",
    );
  };
  // Opens Gmail's compose window filled in; the user attaches the CV and presses Send.
  const openGmail = async (o: Workspace["outreach"][number]) => {
    const url = gmailComposeUrl(w, o);
    if (!url) {
      toast.error("This email is too long to open in Gmail. Use Download email file instead.");
      return;
    }
    // Open the tab now (browsers block pop-ups opened after a wait), fill it in once claimed.
    const tab = window.open("about:blank", "_blank");
    const ok = await mutate((next) => void claimSend(next, o.id, "you (Gmail)"), "");
    if (!ok) {
      tab?.close();
      return;
    }
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    const file = outreachAttachment(w, o);
    if (file) {
      downloadFile(
        file.name,
        Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0)),
        file.mime,
      );
      toast.success(
        `Gmail opened. Attach ${file.name} (just saved to your Downloads), check the email and press Send once. Then confirm it here.`,
      );
    } else
      toast.success("Gmail opened. Check the email and press Send once. Then confirm it here.");
  };
  const notSent = (o: Workspace["outreach"][number]) =>
    void mutate(
      (next) =>
        recordOutreachResult(next, o.id, "failed", "", "You confirmed it was not sent", o.claimId),
      "Recorded as not sent. You can write a new draft.",
    );
  const markSent = (o: Workspace["outreach"][number]) =>
    openModal(
      <Modal title="Record sent email" close={close}>
        <SentForm
          close={close}
          save={async (evidence) => {
            const ok = await mutate(
              (next) => recordOutreachResult(next, o.id, "sent", evidence, "", o.claimId),
              "Recorded as sent",
            );
            if (ok) close();
          }}
        />
      </Modal>,
    );
  const edit = (o: Workspace["outreach"][number]) =>
    openModal(
      <Modal title="Edit email" close={close}>
        <EmailForm
          email={o}
          close={close}
          save={async (change) => {
            const ok = await mutate(
              (next) => editOutreach(next, o.id, change),
              "Saved. Approve it again before sending.",
            );
            if (ok) close();
          }}
        />
      </Modal>,
    );
  const addNew = () =>
    openModal(
      <Modal title="Add a contact" close={close}>
        <ContactForm
          campaigns={w.campaigns}
          campaignId={campaignId === "all" ? (w.campaigns[0]?.id ?? "") : campaignId}
          close={close}
          save={async (input) => {
            const ok = await mutate((next) => void addContact(next, input), "Contact saved");
            if (ok) close();
          }}
        />
      </Modal>,
    );

  return (
    <>
      <section className="cd-panel">
        <div className="cd-panel-heading">
          <h2>Emails</h2>
          <Chip tone="green">
            {queue.sentToday}/{DAILY_SEND_LIMIT} SENT IN 24H
          </Chip>
        </div>
        <p className="cd-subtle">
          Your assistant drafts; you approve each email. Send approved emails yourself with Open in
          Gmail (or a downloaded email file), or let your assistant send them from your own account.
          At most {DAILY_SEND_LIMIT} a day and one per contact every {CONTACT_COOLDOWN_DAYS} days.
        </p>
        {!emails.length ? (
          <Empty icon="✉" title="No emails yet">
            Ask your assistant to find recruiter contacts on public pages and draft short emails.
            They will appear here for your approval.
          </Empty>
        ) : (
          <div className="cd-session-list">
            {emails.map((o) => {
              const c = w.contacts.find((v) => v.id === o.contactId);
              const job = w.jobs.find((j) => j.id === o.jobId);
              const held = queue.held.find((h) => h.id === o.id);
              return (
                <article className="cd-panel" key={o.id}>
                  <div className="cd-panel-heading">
                    <Chip tone={o.status === "sent" ? "green" : ""}>{outreachLabel[o.status]}</Chip>
                    <small>{dateLabel(o.updatedAt)}</small>
                  </div>
                  <h3>{o.subject}</h3>
                  <p className="cd-subtle">
                    To {c?.name ? `${c.name}, ` : ""}
                    {c?.role ? `${c.role}, ` : ""}
                    {c?.company} &lt;{c?.email}&gt;
                    {job ? ` · about ${job.title}` : ""}
                    {o.attachCv ? " · CV attached" : ""}
                  </p>
                  {["draft", "approved"].includes(o.status) && (
                    <ClaimList
                      warnings={checkClaims(
                        w.profile,
                        `${o.subject}
${o.body}`,
                        {
                          company: job?.company ?? c?.company,
                        },
                      )}
                    />
                  )}
                  <details>
                    <summary>Read email</summary>
                    <pre className="cd-json-review cd-email-body">{o.body}</pre>
                  </details>
                  {held && o.status === "approved" && (
                    <p className="cd-callout">On hold: {held.reason}</p>
                  )}
                  {["sending", "unknown"].includes(o.status) && (
                    <p className="cd-callout">
                      Claimed by {o.claimedBy || "a sender"} on {dateLabel(o.claimedAt)}. Check your
                      Sent folder, then confirm. Until then, no other email goes to this contact.
                    </p>
                  )}
                  {o.evidence && <small>Reference: {o.evidence}</small>}
                  {o.notes && <small> · {o.notes}</small>}
                  {o.status === "draft" && (
                    <label className="cd-check">
                      <input
                        type="checkbox"
                        checked={reviewed.has(o.id)}
                        onChange={(e) => {
                          const next = new Set(reviewed);
                          if (e.target.checked) next.add(o.id);
                          else next.delete(o.id);
                          setReviewed(next);
                        }}
                      />{" "}
                      {o.origin === "assistant"
                        ? "Your assistant wrote this. I read every line, every fact is true, and I am the one sending it."
                        : "I read this email, every fact is true, and I am the one sending it."}
                    </label>
                  )}
                  <div className="cd-form-actions cd-email-actions">
                    {o.status === "draft" && (
                      <Button
                        disabled={!reviewed.has(o.id)}
                        onClick={() =>
                          void mutate(
                            (next) => approveOutreach(next, o.id, { reviewed: reviewed.has(o.id) }),
                            "Approved. It can now be sent.",
                          )
                        }
                      >
                        Approve
                      </Button>
                    )}
                    {["draft", "approved"].includes(o.status) && (
                      <>
                        <Button secondary onClick={() => edit(o)}>
                          Edit
                        </Button>
                        <Button
                          secondary
                          onClick={() =>
                            void mutate((next) => rejectOutreach(next, o.id), "Email rejected")
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {o.status === "approved" && (
                      <>
                        <Button onClick={() => void openGmail(o)}>Open in Gmail ✉</Button>
                        <Button secondary onClick={() => void download(o)}>
                          Download email file ↧
                        </Button>
                      </>
                    )}
                    {["sending", "unknown"].includes(o.status) && (
                      <>
                        <Button onClick={() => markSent(o)}>It was sent</Button>
                        <Button secondary onClick={() => notSent(o)}>
                          It wasn't sent
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="cd-panel">
        <div className="cd-panel-heading">
          <h2>Contacts</h2>
          <Button secondary onClick={addNew} disabled={!w.campaigns.length}>
            ＋ Add contact
          </Button>
        </div>
        <p className="cd-subtle">
          Business emails published on public pages, each with its source. No phone numbers or
          scraped personal data. Mark anyone who asks not to be contacted.
        </p>
        {!contacts.length ? (
          <Empty icon="♙" title="No contacts yet">
            Your assistant can add recruiter emails it finds on job posts or company careers pages.
          </Empty>
        ) : (
          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Source</th>
                  <th>Last emailed</th>
                  <th>
                    <span className="cd-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const last = lastContacted(w, c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name || c.email}</strong>
                        <small>
                          {[c.role, c.company, c.name ? c.email : ""].filter(Boolean).join(" · ")}
                        </small>
                        {c.doNotContact && <Chip>DO NOT CONTACT</Chip>}
                      </td>
                      <td>
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                          Source ↗
                        </a>
                      </td>
                      <td>{last ? dateLabel(last) : "—"}</td>
                      <td>
                        <Button
                          secondary
                          onClick={() =>
                            void mutate(
                              (next) => setDoNotContact(next, c.id, !c.doNotContact),
                              c.doNotContact ? "Contact allowed again" : "Marked do not contact",
                            )
                          }
                        >
                          {c.doNotContact ? "Allow contact" : "Do not contact"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function SentForm({
  close,
  save,
}: {
  close: () => void;
  save: (evidence: string) => Promise<void>;
}) {
  const [evidence, setEvidence] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(evidence);
      }}
    >
      <Field
        label="Reference"
        required
        value={evidence}
        onChange={setEvidence}
        hint="For example: 'Sent from Gmail, 11 Nov 2026 10:42' or the message ID."
      />
      <div className="cd-form-actions">
        <Button secondary onClick={close}>
          Cancel
        </Button>
        <Button type="submit">Record as sent</Button>
      </div>
    </form>
  );
}

function EmailForm({
  email,
  close,
  save,
}: {
  email: Workspace["outreach"][number];
  close: () => void;
  save: (change: { subject: string; body: string; attachCv: boolean }) => Promise<void>;
}) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const [attachCv, setAttachCv] = useState(email.attachCv);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ subject, body, attachCv });
      }}
    >
      <div className="cd-form-grid">
        <Field label="Subject" required value={subject} onChange={setSubject} />
        <Field label="Email" area required value={body} onChange={setBody} />
      </div>
      <label className="cd-check">
        <input type="checkbox" checked={attachCv} onChange={(e) => setAttachCv(e.target.checked)} />
        Attach my CV
      </label>
      <div className="cd-form-actions">
        <Button secondary onClick={close}>
          Cancel
        </Button>
        <Button type="submit">Save email</Button>
      </div>
    </form>
  );
}

function ContactForm({
  campaigns,
  campaignId,
  close,
  save,
}: {
  campaigns: Campaign[];
  campaignId: string;
  close: () => void;
  save: (input: {
    campaignId: string;
    company: string;
    email: string;
    sourceUrl: string;
    name: string;
    role: string;
  }) => Promise<void>;
}) {
  const [c, setC] = useState({
    campaignId,
    company: "",
    email: "",
    sourceUrl: "",
    name: "",
    role: "",
  });
  const set = (key: keyof typeof c) => (v: string) => setC({ ...c, [key]: v });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(c);
      }}
    >
      <div className="cd-form-grid">
        <Select
          label="Campaign"
          value={c.campaignId}
          onChange={set("campaignId")}
          options={campaigns.map((v) => ({ value: v.id, label: v.name }))}
        />
        <Field label="Company" required value={c.company} onChange={set("company")} />
        <Field
          label="Business email"
          type="email"
          required
          value={c.email}
          onChange={set("email")}
        />
        <Field
          label="Where you found it"
          required
          value={c.sourceUrl}
          onChange={set("sourceUrl")}
          hint="Link to the job post or company page that publishes this address"
        />
        <Field label="Name" value={c.name} onChange={set("name")} />
        <Field
          label="Role"
          value={c.role}
          onChange={set("role")}
          placeholder="Talent Acquisition"
        />
      </div>
      <div className="cd-form-actions">
        <Button secondary onClick={close}>
          Cancel
        </Button>
        <Button type="submit">Save contact</Button>
      </div>
    </form>
  );
}

function ClaimList({ warnings }: { warnings: ClaimWarning[] }) {
  if (!warnings.length)
    return <p className="cd-claims ok">✓ Every checked claim is backed by your profile or CV.</p>;
  return (
    <div className="cd-claims" role="status">
      <strong>
        Check {warnings.length} {warnings.length === 1 ? "statement" : "statements"} before
        approving
      </strong>
      <ul>
        {warnings.map((x) => (
          <li key={`${x.kind}:${x.found}`}>{x.message}</li>
        ))}
      </ul>
      <small>
        These aren't in your profile or CV. Remove them, or add them to your profile if they are
        true. Placeholders block approval.
      </small>
    </div>
  );
}

type ConnectionStatus = {
  folder: string;
  server: "dev" | "preview" | "launcher";
  workspace: { ok: boolean; revision?: number; error?: string };
  connector: { path: string; built: boolean };
  hosts: {
    id: string;
    name: string;
    found: boolean;
    registered: boolean;
    ready: boolean;
    problem?: string;
    setup: string;
  }[];
};
type TestResult = { ok: boolean; message: string; ms: number };

function ConnectionsPanel({ liveStatus }: { liveStatus: LiveStatus | null }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useCallback(() => {
    fetch("/__career-desk/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then((s: ConnectionStatus) => {
        setStatus(s);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(refresh, [refresh]);
  const runTest = async () => {
    setTesting(true);
    try {
      const r = await fetch("/__career-desk/connection-test", { method: "POST" });
      setTest(await r.json());
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : String(e), ms: 0 });
    } finally {
      setTesting(false);
      refresh();
    }
  };
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Select and copy the text manually"),
    );
  const row = (ok: boolean | "warn", label: string, detail: ReactNode) => (
    <li className={`cd-conn-row ${ok === true ? "ok" : ok === "warn" ? "warn" : "bad"}`}>
      <span aria-hidden="true">{ok === true ? "✓" : ok === "warn" ? "!" : "✕"}</span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </li>
  );
  if (error)
    return (
      <section className="cd-panel">
        <h2>Connections</h2>
        <p className="cd-callout">Couldn't read the connection status: {error}</p>
      </section>
    );
  if (!status) return null;
  const readyHosts = status.hosts.filter((h) => h.ready).length;
  return (
    <section className="cd-panel">
      <div className="cd-panel-heading">
        <h2>Connections</h2>
        <Chip tone={readyHosts ? "green" : ""}>
          {readyHosts} OF {status.hosts.length} ASSISTANTS READY
        </Chip>
      </div>
      <ul className="cd-conn-list">
        {row(
          status.workspace.ok,
          "Workspace",
          status.workspace.ok
            ? `Revision ${status.workspace.revision} in ${status.folder}`
            : `${status.workspace.error} (${status.folder})`,
        )}
        {row(
          liveStatus === "reconnecting" ? false : liveStatus === "live" ? true : "warn",
          "Live updates",
          liveStatus === "reconnecting"
            ? "Connection lost. Retrying… Is the Career Desk window still open?"
            : liveStatus === "live"
              ? "Changes from assistants appear here automatically"
              : "Connecting…",
        )}
        {row(
          status.connector.built,
          "Assistant connector",
          status.connector.built
            ? status.connector.path
            : "Not built yet. Run: pnpm --filter @tailorats/app run local:build",
        )}
        {status.hosts.map((h) => (
          <li key={h.id} className={`cd-conn-row ${h.ready ? "ok" : h.registered ? "bad" : "off"}`}>
            <span aria-hidden="true">{h.ready ? "✓" : h.registered ? "✕" : "○"}</span>
            <div>
              <strong>{h.name}</strong>
              <small>
                {h.ready
                  ? "Set up for this workspace"
                  : h.problem
                    ? h.problem
                    : h.found
                      ? "Installed, Career Desk not added yet"
                      : "Not found on this PC"}
              </small>
              {!h.ready && (
                <>
                  <button
                    type="button"
                    className="cd-text-button"
                    onClick={() => setOpen(open === h.id ? null : h.id)}
                  >
                    {open === h.id ? "Hide setup" : "How to set up"}
                  </button>
                  {open === h.id && (
                    <div className="cd-prompt">
                      <div>
                        <strong>Run once, then restart {h.name.split(" (")[0]}</strong>
                        <button type="button" onClick={() => copy(h.setup)}>
                          Copy ↗
                        </button>
                      </div>
                      <pre className="cd-email-body">{h.setup}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="cd-form-actions cd-email-actions">
        <Button onClick={() => void runTest()} disabled={testing || !status.connector.built}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button secondary onClick={refresh}>
          Refresh
        </Button>
      </div>
      {test && (
        <p className={`cd-claims ${test.ok ? "ok" : ""}`} role="status">
          {test.ok ? "✓ " : "✕ "}
          {test.message}
          {test.ms ? ` (${(test.ms / 1000).toFixed(1)} s)` : ""}
        </p>
      )}
      <small className="cd-subtle">
        The test starts the connector the way an assistant does and reads your workspace through it.
        Nothing is changed. After setting up an assistant, quit and reopen it so it loads the
        connector.
      </small>
    </section>
  );
}

type RunView = {
  id: string;
  campaignId: string;
  campaignName: string;
  assistant: string;
  target: number;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  endedAt?: string;
  jobsAdded: number;
  steps: { at: string; kind: string; text: string }[];
  summary?: string;
  error?: string;
};
type RunsResponse = {
  assistants: { id: string; name: string }[];
  current: RunView | null;
  recent: RunView[];
};

/** One-click job search through the user's own assistant (D-076). */
function FindJobsPanel({ w, campaignId }: { w: Workspace; campaignId: string }) {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [pick, setPick] = useState(campaignId !== "all" ? campaignId : (w.campaigns[0]?.id ?? ""));
  const [count, setCount] = useState("5");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (campaignId !== "all") setPick(campaignId);
  }, [campaignId]);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/__career-desk/runs", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {
      /* server briefly unavailable; the next poll retries */
    }
  }, []);
  const running = data?.current?.status === "running";
  useEffect(() => {
    void load();
    const t = setInterval(load, running ? 2000 : 15000);
    return () => clearInterval(t);
  }, [load, running]);
  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await r.json();
      if (!r.ok) toast.error(json.error ?? "That didn't work");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void load();
    }
  };
  if (!data || !w.campaigns.length) return null;
  const run = data.current ?? data.recent[0];
  const assistant = data.assistants.find((a) => a.id === who) ?? data.assistants[0];
  const campaign = w.campaigns.find((c) => c.id === pick);
  return (
    <section className="cd-panel">
      <div className="cd-panel-heading">
        <h2>Find jobs</h2>
        <Chip tone={running ? "green" : ""}>{running ? "SEARCHING…" : "RESEARCH ONLY"}</Chip>
      </div>
      {!assistant ? (
        <p className="cd-callout">
          Find jobs uses your own assistant: Codex (ChatGPT plan) or Claude Code (Claude plan).
          Install one, sign in once (for Claude Code: run claude in a terminal), then come back. The
          Claude desktop app alone isn't enough, because its built-in copy only runs inside it.
        </p>
      ) : running && data.current ? (
        <RunProgress
          run={data.current}
          stop={() => void post("/__career-desk/runs/stop")}
          busy={busy}
        />
      ) : (
        <>
          <p className="cd-subtle">
            {assistant.name} searches the web for open roles that match the campaign, opens each
            listing to check it, and saves the good ones here with notes on fit and gaps. It can't
            apply or send email. It uses your plan's allowance and usually takes 3–10 minutes.
          </p>
          <div className="cd-form-grid">
            <Select
              label="Campaign"
              value={pick}
              onChange={setPick}
              options={w.campaigns.map((c) => ({ value: c.id, label: c.name }))}
            />
            {data.assistants.length > 1 && (
              <Select
                label="Assistant"
                value={assistant.id}
                onChange={setWho}
                options={data.assistants.map((a) => ({ value: a.id, label: a.name }))}
              />
            )}
            <Select
              label="How many new jobs"
              value={count}
              onChange={setCount}
              options={["3", "5", "10"].map((v) => ({ value: v, label: `Up to ${v}` }))}
            />
          </div>
          {campaign && !campaign.titles.trim() && (
            <p className="cd-callout">
              Add target roles to this campaign first, so the search knows what to look for.
            </p>
          )}
          <div className="cd-form-actions cd-email-actions">
            <Button
              disabled={busy || !campaign || !campaign.titles.trim()}
              onClick={() =>
                void post("/__career-desk/runs", {
                  campaignId: pick,
                  count: Number(count),
                  assistant: assistant.id,
                })
              }
            >
              🔍 Find jobs
            </Button>
          </div>
          {run && run.status !== "running" && (
            <p className={`cd-claims ${run.status === "done" ? "ok" : ""}`} role="status">
              Last search ({run.campaignName}, {dateLabel(run.startedAt)}):{" "}
              {run.summary ?? run.status}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Job-board leads through JobSpy (LinkedIn, Indeed, Naukri), ranked by the
 * smart matcher. Nothing is saved until the user picks leads; saved leads stay
 * unverified until someone checks the live listing.
 */
function JobBoardsPanel({
  w,
  campaignId,
  mutate,
}: {
  w: Workspace;
  campaignId: string;
  mutate: Mutate;
}) {
  const [pick, setPick] = useState(campaignId !== "all" ? campaignId : (w.campaigns[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ campaignId: string; postings: BoardPosting[] } | null>(null);
  const [errors, setErrors] = useState<BoardError[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (campaignId !== "all") setPick(campaignId);
  }, [campaignId]);
  const campaign = w.campaigns.find((c) => c.id === pick);
  // Re-rank on every render, so profile and saved-job changes show at once.
  const ranked = found ? rankPostings(w, found.campaignId, found.postings) : [];
  const search = async () => {
    if (!campaign) return;
    setBusy(true);
    setErrors([]);
    try {
      const r = await fetch("/__career-desk/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: boardQueries(campaign) }),
      });
      const json = (await r.json()) as {
        jobs?: BoardPosting[];
        errors?: BoardError[];
        error?: string;
      };
      if (!r.ok) throw new Error(json.error ?? "The job-board search failed");
      const postings = json.jobs ?? [];
      setFound({ campaignId: campaign.id, postings });
      setErrors(json.errors ?? []);
      setChosen(
        new Set(
          rankPostings(w, campaign.id, postings)
            .filter((c) => !c.alreadySaved && c.match.eligible && c.match.score >= 50)
            .slice(0, 10)
            .map((c) => c.job.url),
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const rows = ranked.filter((c) => chosen.has(c.job.url) && !c.alreadySaved);
    let added = 0;
    const ok = await mutate((next) => {
      for (const c of rows) {
        try {
          addJob(next, c.job);
          added++;
        } catch (e) {
          if (!(e instanceof Error && /already saved/.test(e.message))) throw e;
        }
      }
    }, "");
    if (ok) {
      toast.success(`Saved ${added} leads. Check each live listing before applying.`);
      setChosen(new Set());
    }
  };
  if (!w.campaigns.length) return null;
  return (
    <section className="cd-panel">
      <div className="cd-panel-heading">
        <h2>Job boards</h2>
        <Chip tone={busy ? "green" : ""}>{busy ? "SEARCHING…" : "NO AI · RESEARCH ONLY"}</Chip>
      </div>
      <p className="cd-subtle">
        Searches LinkedIn, Indeed and Naukri for this campaign's target roles (JobSpy, free, no
        sign-in) and ranks results by your skills. Takes 1–4 minutes. Pick the leads to save.
      </p>
      <div className="cd-form-grid">
        <Select
          label="Campaign"
          value={pick}
          onChange={setPick}
          options={w.campaigns.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      <div className="cd-form-actions cd-email-actions">
        <Button disabled={busy || !campaign?.titles.trim()} onClick={() => void search()}>
          ⌕ Search job boards
        </Button>
        {ranked.length > 0 && (
          <Button secondary disabled={busy || !chosen.size} onClick={() => void save()}>
            Save {chosen.size} selected
          </Button>
        )}
      </div>
      {errors.length > 0 && (
        <p className="cd-callout">
          Some boards did not answer: {errors.map((e) => e.site).join(", ")}. The others are shown.
        </p>
      )}
      {found && !ranked.length && !busy && <p className="cd-subtle">No postings found.</p>}
      {ranked.length > 0 && (
        <ul className="cd-conn-list">
          {ranked.slice(0, 40).map((c) => (
            <li key={c.job.url} className={`cd-conn-row ${c.match.eligible ? "ok" : "off"}`}>
              <input
                type="checkbox"
                aria-label={`Save ${c.job.title} at ${c.job.company}`}
                disabled={c.alreadySaved}
                checked={chosen.has(c.job.url)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(c.job.url);
                  else next.delete(c.job.url);
                  setChosen(next);
                }}
              />
              <div>
                <strong>
                  <a href={c.job.url} target="_blank" rel="noreferrer noopener">
                    {c.job.title}
                  </a>
                </strong>{" "}
                · {c.job.company} · {c.job.location || "location unknown"}{" "}
                <small className="cd-subtle">
                  <strong>{c.match.score}% match</strong> · {c.site}
                  {c.datePosted ? ` · ${c.datePosted}` : ""}
                  {c.alreadySaved ? " · already saved" : ""}
                </small>
                <br />
                <small className="cd-subtle">
                  {c.match.skills.matched.length > 0 &&
                    `Have: ${c.match.skills.matched.slice(0, 5).join(", ")}. `}
                  {c.match.skills.missing.length > 0 &&
                    `Missing: ${c.match.skills.missing.slice(0, 5).join(", ")}. `}
                  {!c.match.eligible && (c.match.warnings[c.match.warnings.length - 1] ?? "")}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A clean, ATS-readable CV PDF from the profile, via RenderCV. */
function CvPdfPanel({
  profile,
  local,
  build,
}: {
  profile: Profile;
  local: boolean;
  build: () => void;
}) {
  const theme = (CV_THEMES as readonly string[]).includes(profile.cvTheme)
    ? (profile.cvTheme as CvTheme)
    : "classic";
  return (
    <section className="cd-panel">
      <div className="cd-panel-heading">
        <h2>Your CV</h2>
        <Chip>NO AI NEEDED</Chip>
      </div>
      <p className="cd-subtle">
        {profile.resumeDoc
          ? `Your CV is saved (layout: ${theme}). Edit it here, download it as a PDF, or use Tailored CV PDF on a job to put that job's skills first.`
          : profile.resumeFile
            ? "You added a CV file. To edit it here or change its layout, open the builder; it starts from your profile."
            : "No CV yet? Build one in a few minutes: a short form or your AI assistant's help, then pick one of four layouts."}
      </p>
      <div className="cd-form-actions cd-email-actions">
        <Button onClick={build}>{profile.resumeDoc ? "Edit my CV" : "Build my CV"}</Button>
        {local && (
          <Button
            secondary
            disabled={!profile.name}
            onClick={() =>
              void downloadCvPdf(
                resumeToRenderCv(profileToResume(profile), { theme }),
                profile.name || "CV",
              )
            }
          >
            Download PDF
          </Button>
        )}
      </div>
    </section>
  );
}

function RunProgress({ run, stop, busy }: { run: RunView; stop: () => void; busy: boolean }) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(run.startedAt)) / 60000));
  const steps = run.steps.slice(-8);
  return (
    <div role="status" aria-live="polite">
      <p>
        <strong>
          Searching for {run.campaignName}: {run.jobsAdded} of up to {run.target} saved
        </strong>{" "}
        <small className="cd-subtle">
          · {run.assistant} · {minutes} min
        </small>
      </p>
      <ul className="cd-conn-list">
        {steps.map((s) => (
          <li
            key={`${s.at}-${s.text}`}
            className={`cd-conn-row ${s.kind === "saved" ? "ok" : s.kind === "error" ? "bad" : "off"}`}
          >
            <span aria-hidden="true">
              {s.kind === "saved"
                ? "✓"
                : s.kind === "error"
                  ? "!"
                  : s.kind === "search"
                    ? "⌕"
                    : "·"}
            </span>
            <div>
              <small>{s.text}</small>
            </div>
          </li>
        ))}
      </ul>
      <p className="cd-subtle">
        New jobs appear in the list below as they are saved. You can keep using Career Desk.
      </p>
      <div className="cd-form-actions cd-email-actions">
        <Button secondary disabled={busy} onClick={stop}>
          Stop search
        </Button>
      </div>
    </div>
  );
}
