import { checkClaims, hasPlaceholders } from "./claims";
import {
  type Application,
  type Contact,
  ContactSchema,
  event,
  now,
  type Outreach,
  OutreachSchema,
  renderTemplate,
  uid,
  type Workspace,
} from "./workspace";

/**
 * Assisted applying and cold outreach rules (D-074). Shared by the app and the
 * MCP server so the same limits apply whoever asks. Approvals are made by the
 * user in the app; assistants can draft, read approved work and record results.
 */

export const DAILY_SEND_LIMIT = 15;
export const CONTACT_COOLDOWN_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type ContactInput = Pick<Contact, "campaignId" | "company" | "email" | "sourceUrl"> &
  Partial<Pick<Contact, "name" | "role" | "notes">>;

function campaignFor(w: Workspace, campaignId: string) {
  const c = w.campaigns.find((v) => v.id === campaignId);
  if (!c) throw new Error("Campaign not found");
  return c;
}

function requireDraftMode(w: Workspace, campaignId: string) {
  if (campaignFor(w, campaignId).mode === "research")
    throw new Error(
      "This campaign is research only. Change its permissions to draft to prepare outreach or applications.",
    );
}

export function addContact(w: Workspace, input: ContactInput): Contact {
  campaignFor(w, input.campaignId);
  const email = input.email.trim();
  if (w.contacts.some((c) => c.email.toLowerCase() === email.toLowerCase()))
    throw new Error("This contact is already saved");
  const c = ContactSchema.parse({
    id: uid(),
    campaignId: input.campaignId,
    company: input.company.trim(),
    name: input.name?.trim() ?? "",
    role: input.role?.trim() ?? "",
    email,
    sourceUrl: input.sourceUrl.trim(),
    notes: input.notes ?? "",
    doNotContact: false,
    createdAt: now(),
  });
  w.contacts.unshift(c);
  event(w, `Saved contact at ${c.company}`);
  return c;
}

export function setDoNotContact(w: Workspace, contactId: string, value: boolean) {
  const c = w.contacts.find((v) => v.id === contactId);
  if (!c) throw new Error("Contact not found");
  c.doNotContact = value;
  if (value)
    for (const o of w.outreach)
      if (o.contactId === c.id && ["draft", "approved"].includes(o.status)) {
        o.status = "rejected";
        o.updatedAt = now();
      }
  event(w, value ? `Marked do not contact: ${c.company}` : `Allowed contact again: ${c.company}`);
}

export function draftOutreach(
  w: Workspace,
  contactId: string,
  opts: {
    jobId?: string;
    subject?: string;
    body?: string;
    attachCv?: boolean;
    origin?: "template" | "assistant" | "you";
  } = {},
): Outreach {
  const contact = w.contacts.find((v) => v.id === contactId);
  if (!contact) throw new Error("Contact not found");
  if (contact.doNotContact) throw new Error("This contact asked not to be contacted");
  requireDraftMode(w, contact.campaignId);
  if (!w.profile.name || !w.profile.email)
    throw new Error("Save your name and email in Profile first");
  const job = opts.jobId ? w.jobs.find((j) => j.id === opts.jobId) : undefined;
  if (opts.jobId && !job) throw new Error("Job not found");
  const open = w.outreach.find(
    (o) => o.contactId === contactId && ["draft", "approved"].includes(o.status),
  );
  if (open) throw new Error("This contact already has an unsent draft. Edit or reject it first.");
  requireResolved(w, contactId);
  const template = w.templates.find((t) => t.kind === "outreach");
  // Career Desk never sends words the user hasn't owned: either their own
  // template, or text written for them that they read before approving.
  if (opts.body === undefined && !template?.reviewedAt)
    throw new Error(
      "Your email template is still the starter text. Open Templates and write it in your own words (or confirm it), or ask your assistant to draft this email for you to review.",
    );
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(w.profile).filter(([, v]) => typeof v === "string")),
    role: job?.title ?? w.profile.headline,
    company: job?.company ?? contact.company,
    location: job?.location ?? "",
  };
  const o = OutreachSchema.parse({
    id: uid(),
    campaignId: contact.campaignId,
    contactId,
    jobId: job?.id,
    subject:
      opts.subject?.trim() ||
      (job
        ? `${job.title} at ${job.company}: ${w.profile.name}`
        : `Introduction: ${w.profile.name}`),
    body: opts.body ?? renderTemplate(template?.body ?? "{{name}}", values),
    attachCv: opts.attachCv ?? !!w.profile.resumeFile,
    origin: opts.origin ?? (opts.body === undefined ? "template" : "assistant"),
    status: "draft",
    approvedAt: "",
    sentAt: "",
    evidence: "",
    notes: "",
    createdAt: now(),
    updatedAt: now(),
  });
  if (o.attachCv && !w.profile.resumeFile)
    throw new Error("Upload your CV in Profile before attaching it");
  w.outreach.unshift(o);
  event(w, `Drafted email to ${contact.company}; not sent`);
  return o;
}

export function editOutreach(
  w: Workspace,
  id: string,
  change: {
    subject?: string;
    body?: string;
    attachCv?: boolean;
    origin?: "template" | "assistant" | "you";
  },
) {
  const o = mustOutreach(w, id);
  if (!["draft", "approved"].includes(o.status))
    throw new Error("Only unsent emails can be edited");
  Object.assign(o, Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)));
  // Any change after approval needs a fresh approval (and a fresh CV copy).
  o.status = "draft";
  o.approvedAt = "";
  o.attachmentId = undefined;
  o.updatedAt = now();
  OutreachSchema.parse(o);
}

/** Emails to this contact whose outcome nobody has confirmed yet. */
export function unresolvedFor(w: Workspace, contactId: string) {
  return w.outreach.filter(
    (o) => o.contactId === contactId && ["sending", "unknown"].includes(o.status),
  );
}

function requireResolved(w: Workspace, contactId: string) {
  if (unresolvedFor(w, contactId).length)
    throw new Error(
      "An earlier email to this contact may already have been delivered. Confirm whether it was sent before writing or approving another.",
    );
}

/**
 * User action in the app only. The user confirms they read the email and are
 * responsible for sending it; Career Desk and the assistant only drafted it.
 * Freezes the CV that will be attached.
 */
export function approveOutreach(w: Workspace, id: string, confirm: { reviewed: boolean }) {
  const o = mustOutreach(w, id);
  if (o.status !== "draft") throw new Error("Only drafts can be approved");
  if (!confirm.reviewed)
    throw new Error(
      "Confirm that you read this email, that every fact in it is true, and that you are the one sending it",
    );
  if (contactOf(w, o).doNotContact) throw new Error("This contact asked not to be contacted");
  requireResolved(w, o.contactId);
  if (hasPlaceholders(checkClaims(w.profile, [o.subject, o.body].join("\n"))))
    throw new Error("Fill in the [Add …] placeholders before approving this email");
  if (o.attachCv) {
    const file = w.profile.resumeFile;
    if (!file)
      throw new Error("Upload your CV in Profile before approving an email that attaches it");
    const existing = w.attachments.find((f) => f.base64 === file.base64 && f.name === file.name);
    o.attachmentId = existing?.id ?? uid();
    if (!existing) w.attachments.push({ ...file, id: o.attachmentId });
  }
  o.status = "approved";
  o.approvedAt = now();
  o.updatedAt = now();
  event(w, `Approved email to ${contactOf(w, o).company} (you confirmed you reviewed it)`);
}

export function rejectOutreach(w: Workspace, id: string) {
  const o = mustOutreach(w, id);
  if (!["draft", "approved"].includes(o.status))
    throw new Error("Only unsent emails can be rejected");
  o.status = "rejected";
  o.updatedAt = now();
}

export type QueueItem = { outreach: Outreach; contact: Contact };

/** When an email counts as having gone out (or possibly gone out). */
function contactedAt(o: Outreach) {
  if (o.status === "sent") return o.sentAt;
  if (["sending", "unknown"].includes(o.status)) return o.claimedAt;
  return "";
}

/** Approved emails that may be claimed now, plus held ones with the reason. */
export function sendQueue(w: Workspace, at = new Date()) {
  // Claimed and unconfirmed emails use up the daily allowance too.
  const sentToday = w.outreach.filter((o) => {
    const t = contactedAt(o);
    return t && at.getTime() - Date.parse(t) < DAY;
  }).length;
  let room = Math.max(0, DAILY_SEND_LIMIT - sentToday);
  const ready: QueueItem[] = [];
  const held: { id: string; reason: string }[] = [];
  for (const o of w.outreach.filter((v) => v.status === "approved").reverse()) {
    const contact = contactOf(w, o);
    const last = lastContacted(w, contact.id);
    if (contact.doNotContact) held.push({ id: o.id, reason: "Contact is marked do not contact" });
    else if (unresolvedFor(w, contact.id).length)
      held.push({ id: o.id, reason: "An earlier email to this contact is unconfirmed" });
    else if (last && at.getTime() - Date.parse(last) < CONTACT_COOLDOWN_DAYS * DAY)
      held.push({ id: o.id, reason: `Emailed within the last ${CONTACT_COOLDOWN_DAYS} days` });
    else if (room <= 0)
      held.push({ id: o.id, reason: `Daily limit of ${DAILY_SEND_LIMIT} emails reached` });
    else {
      room--;
      ready.push({ outreach: o, contact });
    }
  }
  return { ready, held, sentToday };
}

/**
 * Reserve one approved email for one sender. Saved with the workspace revision
 * check, so two senders can never both claim it. Returns the claim reference
 * that the result must quote.
 */
export function claimSend(w: Workspace, id: string, by: string) {
  const o = mustOutreach(w, id);
  if (o.status === "sending")
    throw new Error(`Already being sent by ${o.claimedBy || "another sender"}. Do not send it.`);
  if (o.status !== "approved") throw new Error("Only approved emails can be sent");
  const hold = sendQueue(w).held.find((h) => h.id === id);
  if (hold) throw new Error(`On hold: ${hold.reason}. Do not send it now.`);
  o.status = "sending";
  o.claimId = uid();
  o.claimedAt = now();
  o.claimedBy = by.slice(0, 100);
  o.updatedAt = now();
  event(w, `Sending email to ${contactOf(w, o).company} (${o.claimedBy})`);
  return o.claimId;
}

/**
 * Record what happened to a claimed email. "unknown" keeps the contact on hold
 * until someone confirms sent or not sent; it is never put back in the queue.
 */
export function recordOutreachResult(
  w: Workspace,
  id: string,
  status: "sent" | "failed" | "unknown",
  evidence: string,
  notes = "",
  claimId?: string,
) {
  const o = mustOutreach(w, id);
  if (!["sending", "unknown"].includes(o.status))
    throw new Error("Only an email that was claimed for sending can have a result");
  if (claimId !== undefined && claimId !== o.claimId)
    throw new Error("This result belongs to a different send attempt");
  if (o.status === "unknown" && status === "unknown") return;
  if (status === "sent") {
    if (!evidence.trim())
      throw new Error("Add the mail provider's message ID or Sent-folder reference");
    o.sentAt = now();
  }
  if (status !== "sent" && !notes.trim()) throw new Error("Explain what happened in notes");
  o.status = status;
  o.evidence = evidence || o.evidence;
  o.notes = notes || o.notes;
  o.updatedAt = now();
  event(w, `Email to ${contactOf(w, o).company}: ${status}`);
}

export function lastContacted(w: Workspace, contactId: string) {
  return w.outreach
    .filter((o) => o.contactId === contactId)
    .map(contactedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

/** The CV copy frozen at approval (never the current profile file). */
export function outreachAttachment(w: Workspace, o: Outreach) {
  if (!o.attachCv || !o.attachmentId) return undefined;
  return w.attachments.find((f) => f.id === o.attachmentId);
}

// ---------- Assisted applying ----------

/** User action in the app only: allow an assistant to fill this application's form. */
export function approveFill(w: Workspace, appId: string, value = true) {
  const a = mustApplication(w, appId);
  requireDraftMode(w, a.campaignId);
  if (value && a.status !== "prepared")
    throw new Error("Only prepared applications can be approved for form filling");
  if (
    value &&
    hasPlaceholders(
      checkClaims(
        w.profile,
        `${a.coverLetter}
${a.outreach}`,
      ),
    )
  )
    throw new Error("Fill in the [Add …] placeholders in the letters before approving");
  a.fillApprovedAt = value ? now() : "";
  a.updatedAt = now();
  const job = w.jobs.find((j) => j.id === a.jobId);
  event(w, `${value ? "Approved" : "Withdrew approval for"} form filling: ${job?.company}`);
}

/** What an assistant may type into the employer's form. Only after user approval. */
export function applyPacket(w: Workspace, appId: string) {
  const a = mustApplication(w, appId);
  if (!a.fillApprovedAt)
    throw new Error(
      "The user has not approved this application for form filling. Ask them to click 'Approve form filling' in Career Desk.",
    );
  if (a.status !== "prepared") throw new Error(`This application is already ${a.status}`);
  requireDraftMode(w, a.campaignId);
  const job = w.jobs.find((j) => j.id === a.jobId);
  const p = a.profileSnapshot;
  return {
    applicationId: a.id,
    applyUrl: job?.url ?? "",
    company: job?.company ?? "",
    role: job?.title ?? "",
    candidate: {
      name: p.name,
      email: p.email,
      phone: p.phone,
      city: p.city,
      headline: p.headline,
      qualifications: p.qualifications,
      skills: p.skills,
      languages: p.languages,
      credentials: p.credentials,
      experienceYears: p.experienceYears,
      noticeDays: p.noticeDays,
      currentLpa: p.currentLpa,
      expectedLpa: p.expectedLpa,
      portfolio: p.portfolio,
    },
    coverLetter: a.coverLetter,
    cvText: a.resume,
    rules: [
      "Fill only the employer's own application form at applyUrl. The user signs in themselves.",
      "Use only the facts above. If a required question is not covered, leave it and ask the user.",
      "Do not create accounts, accept terms, or answer legal or eligibility declarations for the user.",
      "Stop before the final Submit button. The user reviews and submits.",
      "Afterwards record the outcome with update_application: applied needs the confirmation reference; otherwise attempted with notes.",
    ],
  };
}

function mustApplication(w: Workspace, id: string): Application {
  const a = w.applications.find((v) => v.id === id);
  if (!a) throw new Error("Application not found");
  return a;
}
function mustOutreach(w: Workspace, id: string): Outreach {
  const o = w.outreach.find((v) => v.id === id);
  if (!o) throw new Error("Email not found");
  return o;
}
function contactOf(w: Workspace, o: Outreach): Contact {
  const c = w.contacts.find((v) => v.id === o.contactId);
  if (!c) throw new Error("Contact not found");
  return c;
}

// ---------- .eml export (send from any mail app, no assistant needed) ----------

export function emlFor(w: Workspace, o: Outreach): string {
  const contact = contactOf(w, o);
  const boundary = `cd-${o.id}`;
  const enc = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
  const lines = [
    `To: ${contact.name ? `${enc(contact.name)} ` : ""}<${contact.email}>`,
    `From: ${enc(w.profile.name)} <${w.profile.email}>`,
    `Subject: ${enc(o.subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(o.body)),
  ];
  // Approved emails carry the CV frozen at approval; drafts preview the current one.
  const file = o.status === "draft" ? w.profile.resumeFile : outreachAttachment(w, o);
  if (o.attachCv && file)
    lines.push(
      `--${boundary}`,
      `Content-Type: ${file.mime || "application/octet-stream"}; name="${file.name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${file.name}"`,
      "",
      wrap(file.base64),
    );
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

function b64(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function wrap(s: string) {
  return s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

// ---------- Gmail compose (send yourself from Gmail, no setup) ----------

/** Gmail and Chrome handle links up to about this length reliably. */
export const GMAIL_URL_LIMIT = 7_500;

/**
 * Gmail's compose window with recipient, subject and body filled in. Gmail
 * can't take an attachment this way, so the app saves the CV for the user to
 * attach. Returns undefined when the email is too long for a link.
 */
export function gmailComposeUrl(w: Workspace, o: Outreach): string | undefined {
  const contact = contactOf(w, o);
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: contact.email,
    su: o.subject,
    body: o.body,
  });
  // Opens the right Gmail account when the user is signed in to several.
  if (/@/.test(w.profile.email)) params.set("authuser", w.profile.email);
  const url = `https://mail.google.com/mail/?${params.toString()}`;
  return url.length <= GMAIL_URL_LIMIT ? url : undefined;
}
