#!/usr/bin/env python3
"""One-time import of the Nothing Coffee source overlay from checked-in chunks."""
from pathlib import Path
import base64
import hashlib
import io
import lzma
import shutil
import tarfile

ROOT = Path(__file__).resolve().parent
parts = sorted((ROOT / ".source").glob("chunk*.b64"))
if not parts:
    print("Source already imported; no action needed.")
    raise SystemExit(0)
encoded = "".join(f.read_text(encoding="ascii").strip() for f in parts)
archive = base64.b64decode(encoded, validate=True)
actual = hashlib.sha256(archive).hexdigest()
expected = "c8d6b6462385873c5aec195f7f0a403492b0fbd07d7b312dbf5c62f3e002930a"
if actual != expected:
    raise SystemExit(f"Archive checksum mismatch: {actual}")
with tarfile.open(fileobj=io.BytesIO(lzma.decompress(archive)), mode="r:") as bundle:
    for member in bundle.getmembers():
        if not member.isfile():
            continue
        out = (ROOT / member.name).resolve()
        if ROOT not in out.parents:
            raise SystemExit(f"Unsafe tar path: {member.name}")
        out.parent.mkdir(parents=True, exist_ok=True)
        with bundle.extractfile(member) as data:
            out.write_bytes(data.read())
original = ROOT / "nothing-coffee"
assets = ROOT / "web" / "assets"
assets.mkdir(parents=True, exist_ok=True)
for src in (original / "assets").glob("*"):
    if src.is_file():
        shutil.copy2(src, assets / src.name)
shutil.copy2(original / "README.md", ROOT / "web" / "README.md")
css = (original / "styles.css").read_bytes()
css_extra = (ROOT / ".bootstrap" / "css-append.css").read_bytes()
(ROOT / "web" / "styles.css").write_bytes(css + css_extra)
shutil.rmtree(ROOT / ".bootstrap")
shutil.rmtree(ROOT / ".source")
print("Imported integrated frontend/backend, workers, infrastructure, documentation, and configuration.")
