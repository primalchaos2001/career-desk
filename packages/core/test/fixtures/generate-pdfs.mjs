/**
 * Generates the checked-in PDF fixtures for ingest tests (O-01).
 * Rerun after changing:  node test/fixtures/generate-pdfs.mjs  (from packages/core)
 *
 * pdf-lib is used instead of LaTeX so fixture generation needs no system
 * TeX install and stays deterministic (see ADR D-020).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "pdf");
mkdirSync(OUT, { recursive: true });

// 1x1 red pixel PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function makePdf({ name, pages, withPhoto = false }) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const pageLines of pages) {
    const page = doc.addPage([595, 842]); // A4
    let y = 800;
    if (withPhoto && pageLines === pages[0]) {
      const png = await doc.embedPng(TINY_PNG);
      page.drawImage(png, { x: 495, y: 762, width: 60, height: 60 });
    }
    for (const line of pageLines) {
      const heading = typeof line !== "string";
      const text = heading ? line.h : line;
      page.drawText(text, {
        x: 40,
        y,
        size: heading ? 14 : 10,
        font: heading ? bold : regular,
        color: rgb(0, 0, 0),
      });
      y -= heading ? 26 : 16;
    }
  }
  writeFileSync(join(OUT, name), await doc.save());
  console.log("wrote", name);
}

const h = (t) => ({ h: t });

await makePdf({
  name: "us-clean.pdf",
  pages: [
    [
      "Avery Chen",
      "avery.chen@example.edu | github.com/averychen | Austin, TX",
      h("EDUCATION"),
      "University of Example — B.S. Computer Science, GPA 3.7/4.0, 2022-2026",
      "Coursework: Data Structures, Operating Systems, Databases",
      h("EXPERIENCE"),
      "Example Labs — SWE Intern, May 2025 - Aug 2025",
      "Optimized API caching, reducing p95 latency 40% across 12 services",
      h("PROJECTS"),
      "shardkv — distributed key-value store handling 10k ops/s (Go, Raft)",
      h("SKILLS"),
      "Python, TypeScript, Go, PostgreSQL, Docker",
    ],
  ],
});

await makePdf({
  name: "india-fresher.pdf",
  withPhoto: true,
  pages: [
    [
      "Rohan Gupta",
      "rohan.gupta@example.edu | +91 90000 00000",
      h("Personal Details"),
      "Date of Birth: 14/03/2003",
      "Nationality: Indian",
      h("Education"),
      "Example Institute of Technology — B.Tech CSE, CGPA 8.6/10, 2021-2025",
      h("Projects"),
      "College fest portal — organised registrations, optimised page colour themes",
    ],
    [
      h("Skills"),
      "Java, Python, MySQL",
      h("Declaration"),
      "I hereby declare that the above information is true to the best of my knowledge.",
    ],
  ],
});

await makePdf({
  name: "de-lebenslauf.pdf",
  withPhoto: true,
  pages: [
    [
      "Lukas Weber",
      "lukas.weber@example.de | Muenchen",
      h("Persönliche Daten"),
      "Geburtsdatum: 01.01.2002",
      "Familienstand: ledig",
      h("Education"),
      "Technische Universitaet — B.Sc. Informatik, 2021-2025",
      h("Skills"),
      "C++, Python, MATLAB",
    ],
  ],
});

// A made-up Indian engineering CV (photo, uppercase name, plain 10-digit phone)
// standing in for a real one: exercises education, skills, projects and work.
await makePdf({
  name: "dv-engineer-sample.pdf",
  withPhoto: true,
  pages: [
    [
      "PRIYA SHARMA",
      "priya.sharma@example.com | 9000000001 | Bengaluru",
      h("EDUCATION"),
      "Example Institute of Technology — B.Tech Electronics, CGPA 8.4/10, 2019-2023",
      h("SKILLS"),
      "SystemVerilog, UVM, SVA, Python, Perl, AXI, APB",
      h("PROJECTS"),
      "Audio accelerator testbench — UVM environment with 92% functional coverage",
      "Built constrained-random sequences and SVA checkers for the AXI interface",
      h("WORK EXPERIENCE"),
      "Example Silicon — Design Verification Engineer, Jul 2023 - Present",
      "Closed coverage on a DMA block, finding 14 RTL bugs before tape-out",
    ],
  ],
});

// Two-column layout: same y coordinates, left column x=40, right column x=320.
async function makeTwoColumnPdf() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);

  page.drawText("Lee Wong", { x: 40, y: 800, size: 16, font: bold });
  page.drawText("lee.wong@example.edu | github.com/leewong", {
    x: 40,
    y: 782,
    size: 10,
    font: regular,
  });

  const left = [
    ["EXPERIENCE", true],
    ["Campus IT — Assistant", false],
    ["Resolved 300+ tickets with 95% satisfaction", false],
    ["Example Corp — Intern", false],
    ["Automated reports, saving 6 hours weekly", false],
    ["PROJECTS", true],
    ["chatapp — realtime chat, 500 users", false],
    ["parser — resume PDF text extractor", false],
  ];
  const right = [
    ["EDUCATION", true],
    ["University of Example", false],
    ["B.S. Computer Science", false],
    ["GPA 3.6/4.0, 2022-2026", false],
    ["SKILLS", true],
    ["TypeScript, Go, Python", false],
    ["PostgreSQL, Docker, AWS", false],
    ["LANGUAGES", true],
    ["English, Mandarin", false],
  ];
  let y = 750;
  for (const [text, heading] of left) {
    page.drawText(text, { x: 40, y, size: heading ? 13 : 10, font: heading ? bold : regular });
    y -= heading ? 24 : 15;
  }
  y = 750;
  for (const [text, heading] of right) {
    page.drawText(text, { x: 340, y, size: heading ? 13 : 10, font: heading ? bold : regular });
    y -= heading ? 24 : 15;
  }
  writeFileSync(join(OUT, "two-column.pdf"), await doc.save());
  console.log("wrote two-column.pdf");
}
await makeTwoColumnPdf();

// "Designer" resume: no recognizable section headings, images, many fonts.
async function makeArtsyPdf() {
  const doc = await PDFDocument.create();
  const fonts = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.Courier),
    doc.embedFont(StandardFonts.TimesRomanItalic),
    doc.embedFont(StandardFonts.CourierBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const page = doc.addPage([595, 842]);
  const png = await doc.embedPng(TINY_PNG);
  page.drawImage(png, { x: 480, y: 760, width: 70, height: 70 });
  page.drawImage(png, { x: 40, y: 60, width: 500, height: 8 });
  const lines = [
    "Jordan Fox ~ creative technologist",
    "my journey so far",
    "made cool things at Example Studio",
    "what i play with",
    "figma, blender, p5.js, three.js",
    "where i learned stuff",
    "Example College of Design 2022-2026",
  ];
  lines.forEach((text, i) => {
    page.drawText(text, {
      x: 40,
      y: 760 - i * 40,
      size: 11 + (i % 3) * 2,
      font: fonts[i % fonts.length],
    });
  });
  writeFileSync(join(OUT, "artsy-no-headings.pdf"), await doc.save());
  console.log("wrote artsy-no-headings.pdf");
}
await makeArtsyPdf();
