# Using Career Desk

Career Desk runs on your PC: `Career Desk.cmd` starts a small local server and
opens `http://127.0.0.1:5317/workspace`. Your workspace is one folder,
`~/CareerDesk` by default (set `CAREER_DESK_DIR` to move it). Assistants you
connect read and write the same folder through the Career Desk connector, and
the open app shows their changes live.

## First start

The guide on the Overview page has three steps:

1. **Your CV.** Upload a PDF, .tex or .txt CV, or build one: a short form, one of
   four layouts, or an interview by ChatGPT, Gemini or Antigravity whose answer
   you paste back. Skills and years of experience are filled in from the CV.
2. **What and where.** Role, city and expected salary (lakh per annum). This
   creates your first campaign.
3. **Find jobs.** Searches LinkedIn, Indeed and Naukri and saves the best
   matches as unverified leads. Open each listing and mark it checked.

## Day to day

- **Campaigns** keep separate searches (roles, locations, target companies,
  exclusions, minimum salary) and a permission mode: *research* (find jobs
  only), *draft* (also prepare applications and emails) or *authorized*.
- **Opportunities** shows each job's match score with the reasons: matched,
  related and missing skills, experience and seniority, salary, location.
  Scores describe fit, not your chances. Each card can:
  - make a **tailored CV PDF** that puts that job's skills first (it never adds
    skills you don't have);
  - **find a recruiter email** published in the job post or on the employer's
    own careers and contact pages, with the page it came from;
  - prepare an application (cover letter and outreach text from your profile,
    checked for claims your profile doesn't support).
- **Morning search** (on a campaign): a free job-board search every day at 9:00
  for the first week, then Career Desk asks before continuing three days at a
  time. Letting your assistant search as well is a separate switch and uses your
  assistant plan. Career Desk must be running; "start with Windows" is an
  opt-in.
- **Find jobs** asks your own assistant (Codex or Claude Code) to search the web,
  open each listing and save the good ones with notes. It can only use Career
  Desk's research tools and web search: it can't apply, send email or change
  files.

## Emails

You stay the sender:

1. Write your email template in **Templates** (the starter text must be saved as
   your own wording first), or let your assistant draft each email (marked as
   assistant-written).
2. Approve each email, ticking that you read it, every fact is true and you are
   the one sending it.
3. Send it yourself with **Open in Gmail** (Gmail opens with everything filled
   in; attach the CV it saves to Downloads) or a downloaded email file, or let
   your assistant send it from your own account. Confirm in the app afterwards.

Limits: at most 15 emails a day and one per contact every 14 days. Mark anyone
who asks as do-not-contact.

## Connecting an assistant

**Assistants & backup → Connections** shows which assistants are set up and the
command for any that aren't. See [connections](connections/README.md) for the
details of each assistant and what the connector can do.

## Privacy and backup

- Everything is in your workspace folder: profile, CV files, jobs, contacts,
  emails. There is no Career Desk server or account.
- Sharing the folder or connecting an assistant shares its contents with that
  assistant's provider. No mailbox passwords or API keys are stored.
- Job-board search and the email finder make ordinary web requests from your PC
  (job boards; the employer's public pages, respecting robots.txt).
- Back up by copying the folder, or export a ZIP from **Assistants & backup**.
  Imports are reviewed before they replace anything.
- Every save checks the workspace revision, so a tab or assistant can't silently
  overwrite newer changes.

## Without the launcher

`pnpm dev` serves the same app for development. A static build (`pnpm build`)
stores the workspace in the browser instead of a folder; use the ZIP export to
hand it to an assistant and import the result back.
