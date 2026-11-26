import { describe, expect, it } from "vitest";
import { toJobInput } from "../src/lib/boards";
import { postingSkills, yearsRequired } from "../src/lib/match/matcher";
import { plainText } from "../src/lib/text";

const BOARD_MD = String.raw`**Location:** Bengaluru **Experience:** 4 to 10 Years

## Job Description

We are looking for a **Design Verification Engineer** to join our R\&D team\.

**Requirements:**

* 4\+ years of SystemVerilog and UVM
* AMBA protocols \(AXI, AHB\)
- Scripting in *Python* or __Perl__

---

Apply on [our careers page](https://chipco.com/careers) or [https://chipco.com/jobs](https://chipco.com/jobs)\.`;

describe("plainText", () => {
  it("turns board Markdown into readable text", () => {
    const t = plainText(BOARD_MD);
    expect(t).toContain("Location: Bengaluru Experience: 4 to 10 Years");
    expect(t).toContain(
      "Job Description\n\nWe are looking for a Design Verification Engineer to join our R&D team.",
    );
    expect(t).toContain(
      "• 4+ years of SystemVerilog and UVM\n• AMBA protocols (AXI, AHB)\n• Scripting in Python or Perl",
    );
    expect(t).toContain(
      "our careers page (https://chipco.com/careers) or https://chipco.com/jobs.",
    );
    expect(t).not.toMatch(/\*\*|\|##|---/);
  });
  it("leaves plain text alone and keeps the matcher's reading", () => {
    const plain = "Requirements:\n- 3+ years ASIC verification\nC++ and 2*3 are fine";
    expect(plainText(plain)).toBe(
      "Requirements:\n• 3+ years ASIC verification\nC++ and 2*3 are fine",
    );
    const t = plainText(BOARD_MD);
    expect(yearsRequired(t)).toBe(4);
    expect(postingSkills("DV Engineer", t).has("systemverilog")).toBe(true);
  });
  it("is applied when a job-board posting is saved", () => {
    const job = toJobInput(
      {
        site: "naukri",
        title: "DV Engineer",
        job_url: "https://www.naukri.com/x",
        description: BOARD_MD,
      },
      "c1",
    );
    expect(job.description).not.toContain("**");
  });
});
