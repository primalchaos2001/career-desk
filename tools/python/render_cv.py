"""Render a CV to PDF with RenderCV and print it as JSON.

Uses RenderCV (https://github.com/rendercv/rendercv, MIT License, Copyright (c)
2023 to present Sina Atalay and individual contributors; see
third_party/rendercv/LICENSE) through its command line, which typesets with
Typst. The PDF is text-based, so applicant tracking systems can read it.

Input (stdin, JSON): {"doc": <RenderCV document: {"cv": ..., "design": ...}>}
Output (stdout, JSON): {"pdfBase64": "...", "markdown": "...", "typst": "..."}
                    or {"error": "..."}
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    args = json.loads(sys.stdin.read() or "{}")
    doc = args.get("doc")
    if not isinstance(doc, dict) or not isinstance(doc.get("cv"), dict):
        print(json.dumps({"error": "doc with a cv section is required"}))
        return
    with tempfile.TemporaryDirectory(prefix="career-desk-cv-") as tmp:
        folder = Path(tmp)
        source = folder / "cv.yaml"
        # JSON is valid YAML, and it avoids quoting surprises in user text.
        source.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        out = folder / "out"
        env = {**os.environ, "NO_COLOR": "1"}
        run = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", "-m", "rendercv", "render", str(source),
             "--output-folder", str(out), "--dont-generate-png"],
            cwd=tmp, env=env, capture_output=True, text=True, encoding="utf-8", timeout=180,
        )
        pdfs = sorted(out.glob("*.pdf"))
        if run.returncode != 0 or not pdfs:
            detail = (run.stdout + run.stderr).strip().splitlines()[-12:]
            print(json.dumps({"error": "RenderCV could not build the PDF: " + " ".join(detail)[:900]}))
            return
        pdf = pdfs[0]
        read = lambda suffix: next((p.read_text("utf-8") for p in out.glob(f"*{suffix}")), "")
        print(json.dumps({
            "pdfBase64": base64.b64encode(pdf.read_bytes()).decode("ascii"),
            "markdown": read(".md"),
            "typst": read(".typ"),
        }))


if __name__ == "__main__":
    main()
