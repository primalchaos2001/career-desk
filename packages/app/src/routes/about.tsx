import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  return (
    <article className="container-prose py-16 prose-neutral">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        About
      </p>
      <h1 className="mt-3 font-serif text-4xl">Free, honest, in your browser.</h1>

      <p className="mt-6 text-lg leading-relaxed">
        Every other résumé tool sells a fake “ATS score” and gates the actual advice behind a
        subscription. CV Guide is the opposite: everything runs in your browser, nothing is stored
        on our servers, and there is no paywall — because there is no server to pay for.
      </p>

      <h2 className="mt-10 font-serif text-2xl">What you get</h2>
      <ul className="mt-4 list-disc pl-6 space-y-2">
        <li>Three real scores — parse fidelity, recruiter findability, human impact.</li>
        <li>A prioritized list of fixes tuned to your region, role, industry, and career stage.</li>
        <li>Concrete before/after rewrites you can accept or dismiss.</li>
        <li>A local history of past runs — you can delete any of them at any time.</li>
      </ul>

      <h2 className="mt-10 font-serif text-2xl">What we won’t do</h2>
      <ul className="mt-4 list-disc pl-6 space-y-2">
        <li>Invent an “ATS pass rate”.</li>
        <li>Send your résumé to a server.</li>
        <li>Ask you to sign up.</li>
        <li>Charge you.</li>
      </ul>

      <p className="mt-12">
        <Link to="/ats" className="text-primary underline underline-offset-4">
          Read: what ATS really do →
        </Link>
      </p>
      <p className="mt-3">
        <Link to="/" className="text-primary underline underline-offset-4">
          ← Back to the analyzer
        </Link>
      </p>
    </article>
  );
}
