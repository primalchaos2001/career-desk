import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { clearAll } from "@/lib/reportStore";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

const KEY_STORAGE = "cv-guide.aiKey";

function Settings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const v = localStorage.getItem(KEY_STORAGE) ?? "";
    setKey(v);
    setSaved(!!v);
  }, []);

  function save() {
    if (key.trim()) {
      localStorage.setItem(KEY_STORAGE, key.trim());
      setSaved(true);
      toast.success("Saved locally");
    } else {
      localStorage.removeItem(KEY_STORAGE);
      setSaved(false);
      toast.message("Cleared");
    }
  }

  async function onWipe() {
    if (!confirm("Delete ALL local reports and settings?")) return;
    await clearAll();
    localStorage.removeItem(KEY_STORAGE);
    setKey("");
    setSaved(false);
    toast.success("Local data wiped");
  }

  return (
    <div className="container-prose py-16">
      <h1 className="font-serif text-3xl">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        CV Guide is 100% browser-only. Nothing here is sent anywhere.
      </p>

      <section className="mt-10">
        <h2 className="font-serif text-xl">Optional AI key</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If you add an OpenAI-compatible key, future versions will use it in your browser for extra
          bullet rewrites. It’s stored only in this browser’s localStorage and never sent to us.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          className="mt-4 w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {saved ? "Update key" : "Save key"}
          </button>
          {saved && <span className="text-xs text-muted-foreground">Key is stored locally.</span>}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-xl">Local data</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          All reports live in this browser’s IndexedDB. Use this to reset.
        </p>
        <button
          type="button"
          onClick={onWipe}
          className="mt-4 rounded border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          Wipe all local data
        </button>
      </section>
    </div>
  );
}
