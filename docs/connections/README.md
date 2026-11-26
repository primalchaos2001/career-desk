# Connecting assistants

Career Desk includes a local MCP connector (`career-desk-mcp.mjs`). An assistant
app starts it on your PC; it reads and writes the same workspace folder as the
app, through the app's own validation, so the open app updates live and the
activity log records which assistant made each change. The connector needs no
API key: the assistant brings its own sign-in, model and web tools.

**Assistants & backup → Connections** in the app shows which assistants are set
up, gives the exact setup command for any that aren't, and runs a read-only
**Test connection**.

## Setup

The download includes the built connector at
`packages/app/dist-mcp/career-desk-mcp.mjs` (from source, run
`pnpm --filter @tailorats/app run local:build`). Replace `C:/path/to/CareerDesk`
below with the folder you unzipped. The connector uses `~/CareerDesk` unless you
pass `--dir <folder>` or set `CAREER_DESK_DIR`; it must point at the same folder
as the app.

| Assistant | Add the connector |
| --- | --- |
| Codex (CLI or app, ChatGPT sign-in) | `codex mcp add career-desk -- node C:/path/to/CareerDesk/packages/app/dist-mcp/career-desk-mcp.mjs` |
| Claude Code (Claude sign-in) | `claude mcp add career-desk -- node C:/path/to/CareerDesk/packages/app/dist-mcp/career-desk-mcp.mjs` |
| Claude desktop app | Settings → Developer → Edit config, then add the JSON below |
| Gemini CLI / Antigravity (Google sign-in) | Add the same JSON to the tool's MCP settings (`~/.gemini/settings.json` for Gemini CLI) |

```json
{
  "mcpServers": {
    "career-desk": {
      "command": "node",
      "args": ["C:/path/to/CareerDesk/packages/app/dist-mcp/career-desk-mcp.mjs"]
    }
  }
}
```

Then ask: "Use Career Desk. Summarize my campaigns, then continue my search."
Assistant apps change often; check their MCP documentation if a step has moved.

## Tools

| Area | Tools |
| --- | --- |
| Reading | `get_overview`, `list_jobs`, `get_job`, `list_contacts`, `get_send_queue` |
| Jobs | `add_job`, `update_job`, `search_job_boards` (JobSpy, ranked by the matcher) |
| Applications | `prepare_application`, `update_application`, `get_apply_packet`, `render_cv` |
| Email | `find_contacts` (published addresses only), `add_contact`, `draft_outreach`, `claim_send`, `record_email_result` |
| Sessions | `save_session` |

Career Desk itself never sends mail, submits forms or deletes records, and no
tool can approve anything: approvals happen in the app. Campaign permission
modes apply (a research campaign can't have applications or emails prepared).
Results include `claimWarnings`: statements your profile doesn't back up.

## Find jobs (one click)

**Find jobs** on the Opportunities page runs your own assistant unattended:
`codex exec` or `claude -p`, whichever is installed and signed in (you choose
when both are). The connector is started for that run as
`--research-only --campaign <id>`, so the assistant can only read the workspace
and save jobs and a session for that campaign, plus use web search. Codex runs
with a read-only sandbox; Claude Code with only the connector and web
search/fetch allowed. Progress shows live; run records are kept in
`<workspace folder>/runs/`.

Claude Code must be installed on its own and signed in once (run `claude` in a
terminal): the copy inside the Claude desktop app only works inside that app.

## Assisted applying

1. The assistant prepares the application (`prepare_application`).
2. You review it in Applications and click **Approve form filling**.
3. The assistant calls `get_apply_packet`, opens the employer's page with its
   browser tools and fills the form from those facts. You sign in yourself. It
   stops before **Submit**.
4. You check and submit. The result is recorded with `update_application`;
   "applied" needs the confirmation reference.

## Cold email

1. `find_contacts` reads the job post and the employer's careers, jobs and
   contact pages for published addresses; `add_contact` saves one with its
   source page. No phone numbers, LinkedIn scraping, people-search sites or
   guessed addresses.
2. `draft_outreach` writes drafts (your CV attached if uploaded). If your
   template is still the starter text, the assistant writes the body from your
   profile and it is marked as assistant-written.
3. You read each draft in **Outreach** and approve, edit or reject it.
4. Sending, one of:
   - **Open in Gmail** or **Download email file** in the app (you press Send);
   - the assistant calls `claim_send`, sends once from your own account, then
     `record_email_result` with the message ID; or leaves a draft in your mail
     for you to send.

Limits enforced in code: 15 emails per 24 hours, one email per contact every
14 days, nothing to do-not-contact contacts, and any edit needs a new approval.
If nobody can tell whether an email went out, that contact is held until you
confirm.

## Example prompts

> Use Career Desk. For each saved VLSI job, run find_contacts and save the best
> published recruiter address. Draft a short email for each about that job,
> attaching my CV. Use only my profile facts. Don't send anything.

> Use Career Desk. Fill the application I approved with get_apply_packet in my
> browser. I'll sign in. Stop before Submit and tell me what to check.

## Design rules for new adapters

- Go through the connector's validated operations; never edit independent
  copies of the workspace.
- Declare capabilities explicitly (read, research writes, document preparation,
  separately approved external actions). No generic shell or file-write tool.
- Return source URLs, evidence and structured errors.
- Keep credentials out of the workspace, exports, downloads and examples.
