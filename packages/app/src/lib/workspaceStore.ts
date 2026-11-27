import { openDB } from "idb";
import { blankWorkspace, now, validateWorkspace, type Workspace } from "./workspace";
import { FOLDER_GUIDE } from "./workspaceTransfer";

/**
 * Where the workspace lives. The UI only talks to this interface, so the same
 * screens work against browser storage (static/hosted build) or a linked folder
 * on disk that an assistant edits directly (local dev/preview server).
 */
export interface WorkspaceStore {
  kind: "browser" | "folder";
  /** Human-readable location, e.g. the folder path. */
  location: string;
  load(): Promise<Workspace>;
  /** Compare-and-swap save. Throws ConflictError if someone else saved first. */
  save(next: Workspace, expectedRevision: number): Promise<Workspace>;
  /** Called when the workspace changes outside this tab. Returns an unsubscribe. */
  watch(
    onChange: (change: ExternalChange) => void,
    onStatus?: (status: LiveStatus) => void,
  ): () => void;
}
export type ExternalChange = { revision: number } | { error: string };
/** "live": receiving file changes; "reconnecting": connection lost, retrying. */
export type LiveStatus = "live" | "reconnecting";

export class ConflictError extends Error {}

const API = "/__career-desk";

/**
 * The saved copy always follows the revision it replaces. The incoming revision
 * is ignored: an imported file may carry any number, even one ahead of disk.
 */
export function nextVersion(next: Workspace, expectedRevision: number): Workspace {
  return validateWorkspace({
    ...next,
    revision: expectedRevision + 1,
    updatedAt: now(),
  });
}

// ---------- Browser storage (IndexedDB) ----------

const database = () =>
  openDB("career-desk", 1, {
    upgrade(db) {
      db.createObjectStore("workspace");
    },
  });

async function loadBrowserWorkspace(): Promise<Workspace | null> {
  const db = await database();
  try {
    const saved = await db.get("workspace", "current");
    return saved ? validateWorkspace(saved) : null;
  } finally {
    db.close();
  }
}

export const browserStore: WorkspaceStore = {
  kind: "browser",
  location: "This browser",
  async load() {
    return (await loadBrowserWorkspace()) ?? blankWorkspace();
  },
  async save(next, expectedRevision) {
    const value = nextVersion(next, expectedRevision);
    const db = await database();
    try {
      const tx = db.transaction("workspace", "readwrite");
      const current = await tx.store.get("current");
      if (current && current.revision !== expectedRevision) {
        tx.abort();
        await tx.done.catch(() => {});
        throw new ConflictError(
          "Your workspace changed in another tab. Reload before saving; your changes were not written.",
        );
      }
      await tx.store.put(value, "current");
      await tx.done;
      return value;
    } finally {
      db.close();
    }
  },
  watch() {
    return () => {};
  },
};

// ---------- Linked folder (served by the local dev/preview server) ----------

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409)
    throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function folderStore(folder: string): WorkspaceStore {
  return {
    kind: "folder",
    location: folder,
    async load() {
      const body = await readJson(await fetch(`${API}/workspace`, { cache: "no-store" }));
      if (!body.workspace) return blankWorkspace();
      try {
        return validateWorkspace(body.workspace);
      } catch (e) {
        throw new Error(`workspace.json in ${folder} is invalid: ${errorText(e)}`);
      }
    },
    async save(next, expectedRevision) {
      const value = nextVersion(next, expectedRevision);
      const body = await putWorkspace(value, expectedRevision);
      if (body.error === "conflict")
        throw new ConflictError(
          "Your workspace changed in another tab or by your assistant. The latest version has been loaded; please redo your last change.",
        );
      if (body.error) throw new Error(body.error);
      return value;
    },
    watch(onChange, onStatus) {
      // The server sends the current revision on every (re)connect, so a page
      // that lost its connection catches up as soon as it is back.
      const source = new EventSource(`${API}/events`);
      source.onopen = () => onStatus?.("live");
      source.onerror = () => onStatus?.("reconnecting");
      source.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.error) onChange({ error: data.error });
        else if (typeof data.revision === "number") onChange({ revision: data.revision });
      };
      return () => source.close();
    },
  };
}

async function putWorkspace(workspace: Workspace, expectedRevision: number | null) {
  return readJson(
    await fetch(`${API}/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, workspace, guide: FOLDER_GUIDE }),
    }),
  );
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message.slice(0, 400) : String(e);
}

/**
 * Use the linked folder when the local server offers one, otherwise browser
 * storage. On first link, an existing browser workspace is copied into the empty
 * folder once, so nothing is lost; the browser copy is left untouched as a backup.
 */
export async function openWorkspaceStore(): Promise<WorkspaceStore> {
  let res: Response;
  try {
    res = await fetch(`${API}/workspace`, { cache: "no-store" });
  } catch {
    return browserStore;
  }
  if (!res.headers.get("content-type")?.includes("application/json")) return browserStore;
  const body = await res.json().catch(() => null);
  if (!body?.folder) return browserStore;
  const store = folderStore(body.folder);
  if (res.ok && body.workspace === null) {
    const existing = (await loadBrowserWorkspace()) ?? blankWorkspace();
    const seeded = await putWorkspace(existing, null);
    if (seeded.error && seeded.error !== "conflict") throw new Error(seeded.error);
  }
  return store;
}
