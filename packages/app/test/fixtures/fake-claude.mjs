// Stands in for `claude -p --output-format stream-json` in runner tests. Mode comes from FAKE_CODEX.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.env.FAKE_CODEX ?? "ok";
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  writeFileSync(join(process.cwd(), "prompt.txt"), prompt);
  writeFileSync(join(process.cwd(), "args.json"), JSON.stringify(process.argv.slice(2)));
  emit({ type: "system", subtype: "init" });
  if (mode === "fail") {
    emit({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Not logged in · Please run /login",
    });
    process.exit(1);
  }
  emit({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "WebSearch", input: { query: "DV jobs Bengaluru" } },
      ],
    },
  });
  const file = join(process.cwd(), "workspace.json");
  const w = JSON.parse(readFileSync(file, "utf8"));
  w.jobs.push({ campaignId: w.campaigns[0].id, id: "fake-job" });
  writeFileSync(file, JSON.stringify(w));
  emit({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "mcp__career-desk__add_job",
          input: { company: "Arm", title: "DV Engineer" },
        },
        {
          type: "tool_use",
          id: "t3",
          name: "mcp__career-desk__add_job",
          input: { company: "Arm", title: "DV Engineer" },
        },
      ],
    },
  });
  emit({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "{}" }] },
        {
          type: "tool_result",
          tool_use_id: "t3",
          is_error: true,
          content: "This job is already saved",
        },
      ],
    },
  });
  emit({ type: "result", subtype: "success", is_error: false, result: "Saved 1 job." });
  process.exit(0);
});
