import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, listTools } from "../server/mcp/tools";
import {
  addContact,
  applyPacket,
  approveFill,
  approveOutreach,
  claimSend,
  DAILY_SEND_LIMIT,
  draftOutreach,
  editOutreach,
  emlFor,
  GMAIL_URL_LIMIT,
  gmailComposeUrl,
  outreachAttachment,
  recordOutreachResult,
  sendQueue,
  setDoNotContact,
} from "../src/lib/outreach";
import {
  addJob,
  blankWorkspace,
  prepareApplication,
  validateWorkspace,
  type Workspace,
} from "../src/lib/workspace";

const campaign = (id: string, mode: "research" | "draft") => ({
  id,
  name: id,
  track: "other" as const,
  titles: "Verification Engineer",
  locations: "Bengaluru",
  keywords: "",
  exclusions: "",
  minLpa: "",
  maxLpa: "",
  mode,
  templateId: "cover",
  notes: "",
  createdAt: new Date().toISOString(),
});

function workspace(): Workspace {
  const w = blankWorkspace();
  for (const t of w.templates) t.reviewedAt = new Date().toISOString();
  w.profile.name = "Test User";
  w.profile.email = "test@example.com";
  // Complete enough that the default templates leave no [Add …] placeholders.
  w.profile.headline = "Design verification engineer";
  w.profile.summary = "I build UVM testbenches.";
  w.profile.skills = "UVM";
  w.profile.qualifications = "M.Tech";
  w.profile.phone = "+91 00000 00000";
  w.profile.resumeFile = { name: "cv.pdf", mime: "application/pdf", base64: "JVBERi0xLjQK" };
  w.campaigns.push(campaign("draft", "draft"), campaign("research", "research"));
  return w;
}
const contact = (w: Workspace, email = "hr@example.com", campaignId = "draft") =>
  addContact(w, {
    campaignId,
    company: "Example Semi",
    email,
    sourceUrl: "https://example.com/careers/contact",
    name: "Asha",
    role: "Talent Acquisition",
  });

describe("cold outreach rules", () => {
  it("needs a public source, and refuses duplicate emails", () => {
    const w = workspace();
    expect(() =>
      addContact(w, { campaignId: "draft", company: "X", email: "a@x.com", sourceUrl: "" }),
    ).toThrow();
    contact(w);
    expect(() => contact(w, "HR@example.com")).toThrow(/already saved/);
  });

  it("drafts only in draft mode and never for do-not-contact", () => {
    const w = workspace();
    const r = contact(w, "r@example.com", "research");
    expect(() => draftOutreach(w, r.id)).toThrow(/research only/);
    const c = contact(w);
    setDoNotContact(w, c.id, true);
    expect(() => draftOutreach(w, c.id)).toThrow(/not to be contacted/);
  });

  it("builds a Gmail compose link with recipient, subject and body", () => {
    const w = workspace();
    w.profile.email = "me@gmail.com";
    const o = draftOutreach(w, contact(w).id);
    const url = new URL(gmailComposeUrl(w, o) ?? "");
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.searchParams.get("to")).toBe("hr@example.com");
    expect(url.searchParams.get("su")).toBe(o.subject);
    expect(url.searchParams.get("body")).toBe(o.body);
    expect(url.searchParams.get("authuser")).toBe("me@gmail.com");
    o.body = "x".repeat(GMAIL_URL_LIMIT);
    expect(gmailComposeUrl(w, o)).toBeUndefined();
  });

  it("cannot be recorded as sent without approval and a message reference", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    expect(o.attachCv).toBe(true);
    expect(() => recordOutreachResult(w, o.id, "sent", "msg-1")).toThrow(/claimed/);
    approveOutreach(w, o.id, { reviewed: true });
    expect(() => recordOutreachResult(w, o.id, "sent", "msg-1")).toThrow(/claimed/);
    const claim = claimSend(w, o.id, "codex");
    expect(() => recordOutreachResult(w, o.id, "sent", "")).toThrow(/message ID/);
    expect(() => recordOutreachResult(w, o.id, "sent", "msg-1", "", "wrong")).toThrow(
      /different send attempt/,
    );
    recordOutreachResult(w, o.id, "sent", "msg-1", "", claim);
    expect(() => validateWorkspace(w)).not.toThrow();
  });

  it("editing an approved email clears the approval", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    approveOutreach(w, o.id, { reviewed: true });
    editOutreach(w, o.id, { body: "Changed" });
    expect(o.status).toBe("draft");
    expect(sendQueue(w).ready).toHaveLength(0);
  });

  it("enforces the daily limit and the per-contact cooldown", () => {
    const w = workspace();
    for (let i = 0; i < DAILY_SEND_LIMIT + 2; i++) {
      const o = draftOutreach(w, contact(w, `hr${i}@example.com`).id);
      approveOutreach(w, o.id, { reviewed: true });
    }
    const q = sendQueue(w);
    expect(q.ready).toHaveLength(DAILY_SEND_LIMIT);
    expect(q.held[0]?.reason).toMatch(/Daily limit/);

    const first = q.ready[0];
    if (!first) throw new Error("queue empty");
    recordOutreachResult(
      w,
      first.outreach.id,
      "sent",
      "msg",
      "",
      claimSend(w, first.outreach.id, "a"),
    );
    const again = draftOutreach(w, first.contact.id);
    approveOutreach(w, again.id, { reviewed: true });
    expect(sendQueue(w).held.find((h) => h.id === again.id)?.reason).toMatch(/last 14 days/);
    expect(() => claimSend(w, again.id, "a")).toThrow(/On hold/);
  });

  it("freezes the CV at approval (review P1)", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    approveOutreach(w, o.id, { reviewed: true });
    w.profile.resumeFile = { name: "replacement.pdf", mime: "application/pdf", base64: "AAAA" };
    expect(emlFor(w, o)).toContain('filename="cv.pdf"');
    expect(emlFor(w, o)).not.toContain("replacement.pdf");
    expect(outreachAttachment(w, o)?.base64).toBe("JVBERi0xLjQK");
    expect(() => validateWorkspace(w)).not.toThrow();
  });

  it("sends emails approved by an older version back for re-approval", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    approveOutreach(w, o.id, { reviewed: true });
    o.attachmentId = undefined; // as saved before CV copies existed
    const migrated = validateWorkspace(JSON.parse(JSON.stringify(w)));
    expect(migrated.outreach[0]?.status).toBe("draft");
    expect(migrated.outreach[0]?.notes).toMatch(/approve again/);
  });

  it("lets only one sender claim an email (review P1)", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    approveOutreach(w, o.id, { reviewed: true });
    claimSend(w, o.id, "codex session 1");
    expect(sendQueue(w).ready).toHaveLength(0);
    expect(() => claimSend(w, o.id, "codex session 2")).toThrow(
      /Already being sent by codex session 1/,
    );
  });

  it("holds a contact while a send is unknown, until it is confirmed (review P1)", () => {
    const w = workspace();
    const c = contact(w);
    const o = draftOutreach(w, c.id);
    approveOutreach(w, o.id, { reviewed: true });
    const claim = claimSend(w, o.id, "codex");
    recordOutreachResult(w, o.id, "unknown", "", "Gmail timed out", claim);
    expect(() => draftOutreach(w, c.id)).toThrow(/may already have been delivered/);
    expect(sendQueue(w).sentToday).toBe(1);
    // Confirmed not sent: the contact is free again (no 14-day wait for a failed send).
    recordOutreachResult(w, o.id, "failed", "", "Not in Sent folder");
    const retry = draftOutreach(w, c.id);
    approveOutreach(w, retry.id, { reviewed: true });
    expect(sendQueue(w).ready.map((r) => r.outreach.id)).toEqual([retry.id]);
  });

  it("exports an .eml with the CV attached", () => {
    const w = workspace();
    const o = draftOutreach(w, contact(w).id);
    const eml = emlFor(w, o);
    expect(eml).toContain("To: =?UTF-8?B?");
    expect(eml).toContain("<hr@example.com>");
    expect(eml).toContain('filename="cv.pdf"');
  });
});

describe("assisted applying", () => {
  it("returns form data only after the user approves this application", () => {
    const w = workspace();
    const job = addJob(w, {
      campaignId: "draft",
      company: "Example Semi",
      title: "DV Engineer",
      url: "https://jobs.example.com/1",
      location: "",
      description: "",
      salaryLpa: "",
      minExperience: "",
      requiredCredentials: "",
      requiredLanguages: "",
      notes: "",
    });
    const app = prepareApplication(w, job.id);
    expect(() => applyPacket(w, app.id)).toThrow(/not approved/);
    approveFill(w, app.id);
    const packet = applyPacket(w, app.id);
    expect(packet.applyUrl).toBe("https://jobs.example.com/1");
    expect(packet.rules.join(" ")).toMatch(/Stop before the final Submit/);
    approveFill(w, app.id, false);
    expect(() => applyPacket(w, app.id)).toThrow(/not approved/);
  });
});

describe("outreach MCP tools", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "career-desk-outreach-"));
    writeFileSync(join(dir, "workspace.json"), JSON.stringify(validateWorkspace(workspace())));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = () => ({ dir, client: "codex" });
  const disk = (): Workspace => JSON.parse(readFileSync(join(dir, "workspace.json"), "utf8"));

  it("lets an assistant draft but not approve, and queues only approved emails with the CV", () => {
    const c = callTool(ctx(), "add_contact", {
      campaignId: "draft",
      company: "Example Semi",
      email: "hr@example.com",
      sourceUrl: "https://example.com/careers",
    }) as { id: string };
    const o = callTool(ctx(), "draft_outreach", { contactId: c.id }) as { id: string };
    expect((callTool(ctx(), "get_send_queue", {}) as { ready: unknown[] }).ready).toHaveLength(0);
    expect(listTools().map((t) => t.name)).not.toContain("approve_outreach");

    const w = disk();
    approveOutreach(w, o.id, { reviewed: true });
    w.revision += 1;
    writeFileSync(join(dir, "workspace.json"), JSON.stringify(w));
    const q = callTool(ctx(), "get_send_queue", {}) as { ready: { outreachId: string }[] };
    expect(q.ready[0]?.outreachId).toBe(o.id);
    const claim = callTool(ctx(), "claim_send", { outreachId: o.id }) as {
      claimId: string;
      attachment: string;
    };
    expect(readFileSync(claim.attachment, "base64")).toBe("JVBERi0xLjQK");
    expect(() => callTool(ctx(), "claim_send", { outreachId: o.id })).toThrow(/Already being sent/);
    callTool(ctx(), "record_email_result", {
      outreachId: o.id,
      claimId: claim.claimId,
      status: "sent",
      evidence: "gmail:123",
    });
    expect(disk().outreach[0]?.status).toBe("sent");
  });

  it("marks read-only tools so hosts can skip approval prompts for them", () => {
    const tools = Object.fromEntries(listTools().map((t) => [t.name, t.annotations.readOnlyHint]));
    expect(tools.get_overview).toBe(true);
    expect(tools.get_send_queue).toBe(true);
    expect(tools.add_job).toBe(false);
  });
});
