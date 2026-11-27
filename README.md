# Career Desk

A job-search workspace that runs on your own PC and works with the AI assistant
you already use. Keep separate campaigns (for example VLSI verification in
Bengaluru, or product roles), let your assistant find and check real openings,
prepare applications and outreach, and approve everything before it goes out.

Your data stays in a folder on your computer. There is no Career Desk server and
no account.

## What it does

- **Profile and campaigns:** one verified profile, many searches with their own
  roles, locations, target companies and permission mode.
- **Find jobs (one click):** your assistant searches the web, opens each listing
  to check it, and saves matching jobs with notes on fit and gaps. Research only:
  it can't apply or send email.
- **Applications:** cover letter and outreach drafts from your profile, with a
  claims check that flags anything your profile doesn't back up. Assisted form
  filling stops before Submit; you submit.
- **Recruiter emails:** finds addresses *published* in the job post or on the
  employer's own careers and contact pages, each with its source page. Never
  guesses addresses.
- **Cold email:** drafts you approve one by one, sent by you (Open in Gmail, or
  an email file) or by your assistant from your own account, with daily limits
  and do-not-contact.
- **Smart matching (no AI):** each job is scored on your skills (required vs
  nice-to-have), how close your CV reads to the posting, and your campaign
  preferences, with the missing skills listed.
- **Job boards:** search LinkedIn, Indeed and Naukri for a campaign in one click
  (JobSpy), ranked by the matcher; save the leads you pick.
- **CV builder and PDFs:** no CV yet? Fill in a short form, pick one of four
  layouts, or let ChatGPT, Gemini or Antigravity interview you and paste the
  result back. Clean, ATS-readable PDFs (RenderCV), and per job a version with
  that job's skills first.
- **Morning search:** optional free job-board search every day at 9:00 for a
  week, then it asks before continuing three days at a time.
- **CV checker:** the TailorATS resume analyzer is included at `/`.

## Download and start

1. Download **CareerDesk-windows.zip** from this repository's **Releases** page and unzip it.
2. Double-click **`Career Desk.cmd`**. Career Desk opens in your browser.
3. Follow the three steps: add your CV (or build one), say what role, where and
   your expected salary, then find jobs. You can turn on a free search every
   morning at 9:00 for a week; after that it asks before continuing.

Node is included in the download. Job-board search and CV PDFs also need
[Python 3.12+](https://www.python.org/downloads/); the first start sets them up
by itself (about a minute). Without Python everything else still works.

Emails are never sent for you: you write your own template (or review what
your assistant drafted) and tick that you read it and are the sender.

### From source

Double-click **`Career Desk.cmd`**. It opens Career Desk in your browser at
`http://127.0.0.1:5317/workspace`. Keep its window open while you work.

It needs Node.js 20+, or the Node runtime that ships with the Codex app, and
the built files (see Development). Your workspace lives in `~/CareerDesk`
(set `CAREER_DESK_DIR` to change it).

## Connect an assistant

Open **Assistants & backup → Connections**. It shows which assistants are set
up and gives the exact command for any that aren't:

| Assistant | Sign-in | Status |
| --- | --- | --- |
| Codex (CLI or app) | ChatGPT plan | Connector and one-click Find jobs |
| Claude Code | Claude plan | Connector and one-click Find jobs |
| Claude desktop | Claude plan | Connector |
| Antigravity (`agy`) | Google account | Connector config documented; detection not yet added |

**Test connection** starts the connector the way an assistant does and checks it
sees the same workspace. Details: [docs/connections](docs/connections/README.md).

## Development

Requires Node.js 20+ and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tailorats/app run local:build   # app + connector + launcher
pnpm test
pnpm dev                                       # Vite dev server, /workspace
```

Job boards and CV PDFs need Python 3.12+ in `.venv` (or set `CAREER_DESK_PYTHON`):

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r tools/python/requirements.txt
```

Key places:

- `packages/app/src/components/CareerWorkspace.tsx`: the Career Desk UI
- `packages/app/src/lib/`: workspace rules, outreach, claims check, storage
- `packages/app/server/`: folder API, launcher, MCP connector, Find jobs runner
- `packages/core`, `pipeline`, `rules`, `llm`: CV reading and analysis (from TailorATS)
- `docs/DECISIONS.md`: decision log (D-071 onwards is Career Desk)

Copied and adapted open-source code is listed in [third_party](third_party/README.md).

## Status

Working on Windows; other systems can run it from source. The workspace format
and connector tools may still change before 1.0. Package names still use the
`@tailorats/` prefix from TailorATS, the browser-only CV checker this project
grew out of.

## License

MIT, see [LICENSE](LICENSE).
