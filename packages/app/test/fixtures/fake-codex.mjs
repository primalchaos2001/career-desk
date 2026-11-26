// Stands in for `codex exec --json` in runner tests. Mode comes from FAKE_CODEX.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_CODEX ?? "ok";
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  writeFileSync(join(process.cwd(), "prompt.txt"), prompt);
  emit({ type: "thread.started" });
  emit({
    type: "item.completed",
    item: { type: "web_search", query: "verification jobs Bengaluru" },
  });
  if (mode === "hang") return setInterval(() => {}, 1000);
  if (mode === "fail") {
    process.stderr.write("Error: not logged in\n");
    process.exit(2);
  }
  // Simulate the connector saving a job into the workspace.
  const file = join(process.cwd(), "workspace.json");
  const w = JSON.parse(readFileSync(file, "utf8"));
  w.jobs.push({ campaignId: w.campaigns[0].id, id: "fake-job" });
  writeFileSync(file, JSON.stringify(w));
  emit({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      tool: "add_job",
      status: "completed",
      arguments: { company: "Arm", title: "DV Engineer" },
      result: { content: [] },
    },
  });
  emit({ type: "turn.completed" });
  process.exit(0);
});
