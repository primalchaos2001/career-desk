import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/ats")({
  component: AtsPage,
});

function AtsPage() {
  return (
    <article className="container-prose py-16 prose-neutral">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        The honest guide
      </p>
      <h1 className="mt-3 font-serif text-4xl">What ATS really do</h1>

      <p className="mt-6 text-lg leading-relaxed">
        You’ve heard it a hundred times:{" "}
        <em>“75% of resumes are rejected by ATS before a human ever sees them.”</em> It’s the
        marketing engine behind every $19-a-month résumé tool. It’s also mostly false.
      </p>

      <h2 className="mt-10 font-serif text-2xl">Myth 1 · “ATS auto-rejects resumes”</h2>
      <p>
        Modern platforms — Workday, Greenhouse, Lever, iCIMS, SAP SuccessFactors —{" "}
        <strong>rank and organise</strong> applications. They don’t silently delete them. When a
        listing has 500 applicants, a recruiter opens the ATS, filters by keyword or knock-out
        question, and reads the top of the list. Everyone else is still there — just further down.
      </p>

      <h2 className="mt-8 font-serif text-2xl">Myth 2 · “The AI reads your bullets”</h2>
      <p>
        Parsing is boring, not smart. The ATS mostly extracts your text, splits it into sections,
        and indexes the keywords. That extraction is where fancy templates die — two-column layouts,
        tables, icons, and text rendered inside images all garble.
      </p>

      <h2 className="mt-8 font-serif text-2xl">Myth 3 · “There’s an ATS score you can beat”</h2>
      <p>
        There isn’t. Recruiters see a candidate list with your extracted highlights and a
        keyword-match count against their search. Different recruiter, different search, different
        order. Any tool that shows you an “ATS score” is inventing one.
      </p>

      <h2 className="mt-10 font-serif text-2xl">What actually gets you filtered out</h2>
      <ul className="mt-4 list-disc pl-6 space-y-2">
        <li>
          Knock-out questions on the application form (work authorization, minimum GPA, years of
          experience).
        </li>
        <li>
          Missing the exact keywords a recruiter searched for, when you do have that experience.
        </li>
        <li>A résumé that parses into gibberish because of layout.</li>
        <li>Region-inappropriate content (photo on a US resume, no photo on a German one).</li>
      </ul>

      <h2 className="mt-10 font-serif text-2xl">What CV Guide does instead</h2>
      <p>
        We give you three real scores — parse fidelity, recruiter findability, human impact — plus a
        prioritized list of fixes tuned to your region, role, and target job. No fake pass rate. No
        pay-wall. No servers: your file never leaves this tab.
      </p>

      <p className="mt-12">
        <Link to="/" className="text-primary underline underline-offset-4">
          ← Back to the analyzer
        </Link>
      </p>
    </article>
  );
}
