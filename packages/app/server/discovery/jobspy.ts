import {
  type BoardError,
  type BoardSearch,
  boardQueries,
  type Candidate,
  rankPostings,
} from "../../src/lib/boards";
import type { Workspace } from "../../src/lib/workspace";
import { runBoardQueries, runPythonTool } from "./python";

export { BOARD_SITES } from "../../src/lib/boards";

/** Run the boards for a campaign and rank the results. Does not save anything. */
export async function searchBoards(
  w: Workspace,
  opts: BoardSearch,
  run: typeof runPythonTool = runPythonTool,
): Promise<{ candidates: Candidate[]; errors: BoardError[] }> {
  const c = w.campaigns.find((x) => x.id === opts.campaignId);
  if (!c) throw new Error("Campaign not found");
  const { jobs, errors } = await runBoardQueries(boardQueries(c, opts), run);
  return { candidates: rankPostings(w, c.id, jobs), errors };
}
