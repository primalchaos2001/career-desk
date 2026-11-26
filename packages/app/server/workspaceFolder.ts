import { join } from "node:path";
import { type Connect, createServer, type Plugin } from "vite";
import { API, createFolderApi, type Validate } from "./folderApi";
import { defaultFolder } from "./folderFile";

export { API, defaultFolder };

/**
 * Linked workspace folder for Vite dev and preview. The app and an assistant
 * share one workspace.json on disk, so assistant edits show up live without the
 * export -> assistant -> import round trip. Static builds are unaffected: without
 * these routes the app falls back to browser storage.
 *
 * `validate` checks a whole workspace (the app's own validateWorkspace). When not
 * given, it is loaded through Vite's module loader so the TypeScript rules are
 * shared with the app instead of copied.
 */
export function workspaceFolder(dir = defaultFolder(), options: { validate?: Validate } = {}) {
  const given = options.validate;
  let loadValidate: (() => Promise<Validate>) | undefined = given ? async () => given : undefined;
  const api = (serverKind: "dev" | "preview", root: string) => {
    const route = createFolderApi({
      dir,
      getValidate: () => loadValidate,
      mcpBundle: join(root, "dist-mcp", "career-desk-mcp.mjs"),
      serverKind,
    });
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
      if (!route(req, res)) next();
    };
    return middleware;
  };

  return {
    name: "career-desk-workspace-folder",
    configureServer(server) {
      loadValidate ??= async () =>
        (await server.ssrLoadModule("/src/lib/workspace.ts")).validateWorkspace as Validate;
      server.middlewares.use(api("dev", server.config.root));
      server.config.logger.info(`  Career Desk workspace folder: ${dir}`);
    },
    configurePreviewServer(server) {
      // Preview has no module loader of its own; start a small one on first write.
      let cached: Promise<Validate> | undefined;
      loadValidate ??= () => {
        cached ??= createServer({
          root: server.config.root,
          configFile: false,
          logLevel: "error",
          server: { middlewareMode: true, hmr: false },
          appType: "custom",
        }).then(
          async (vite) =>
            (await vite.ssrLoadModule("/src/lib/workspace.ts")).validateWorkspace as Validate,
        );
        return cached;
      };
      server.middlewares.use(api("preview", server.config.root));
    },
  } satisfies Plugin;
}
