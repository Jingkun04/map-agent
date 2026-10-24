"""Bundle src/ into a single self-contained page.

Outputs:
  dist/region-map-agent.html   the app, one self-contained file
  index.html                   the same file at the repo root, so GitHub Pages serves it
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
ORDER = ["core.js", "presets.js", "city.js", "bench.js", "view3d.js", "gamemap.js", "agent-model.js", "ui.js"]  # load order matters

js = "\n".join((SRC / f).read_text(encoding="utf-8") for f in ORDER)
assert "</script" not in js, "a source file contains </script>, which would break the inline bundle"
html = (SRC / "template.html").read_text(encoding="utf-8").replace("/*__SCRIPT__*/", js)

out = ROOT / "dist" / "region-map-agent.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")

shutil.copy(out, ROOT / "index.html")        # GitHub Pages serves the repo root

print(f"wrote {out} ({out.stat().st_size // 1024} KB) and index.html")
