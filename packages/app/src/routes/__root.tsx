import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";

/**
 * Root route for the client SPA. The Lovable prototype used TanStack Start's
 * SSR shell (shellComponent + <html> + <Scripts> + HeadContent); in the static
 * SPA those are gone — index.html owns the document shell and page metadata,
 * and this file only provides the in-app chrome (D-026, Start→SPA ADR).
 */

function NotFound() {
  return (
    <div className="container-prose py-24 text-center">
      <h1 className="text-5xl">404</h1>
      <p className="mt-3 text-muted-foreground">This page doesn’t exist.</p>
      <Link to="/" className="mt-6 inline-block text-primary underline underline-offset-4">
        Go home
      </Link>
    </div>
  );
}

function ErrorView({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return (
    <div className="container-prose py-24 text-center">
      <h1 className="text-3xl">Something broke</h1>
      <p className="mt-3 text-muted-foreground">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded border border-border px-4 py-2 text-sm"
      >
        Try again
      </button>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorView,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <SiteChrome />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}

function SiteChrome() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path === "/workspace") return <Outlet />;
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-foreground/15">
        <div className="container-page flex items-center justify-between py-5">
          <Link to="/" className="flex items-baseline gap-3">
            <span className="font-serif italic text-2xl leading-none">CV Guide</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Issue No. 01 / The Honest Analyzer
            </span>
          </Link>
          <nav className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.15em]">
            <Link to="/workspace" className="text-foreground underline underline-offset-4">
              Career Desk ↗
            </Link>
            <Link to="/ats" className="text-muted-foreground hover:text-foreground">
              ATS Truths
            </Link>
            <Link to="/about" className="text-muted-foreground hover:text-foreground">
              About
            </Link>
            <Link to="/history" className="text-muted-foreground hover:text-foreground">
              History
            </Link>
            <Link to="/settings" className="text-muted-foreground hover:text-foreground">
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-foreground/15 mt-16">
        <div className="container-page py-8 flex flex-col gap-2 sm:flex-row sm:justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Free forever · Your résumé never leaves your browser
          </p>
          <p className="font-serif italic text-sm text-muted-foreground">
            No accounts. No servers. No dark patterns.
          </p>
        </div>
      </footer>
    </div>
  );
}
