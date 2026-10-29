#!/usr/bin/env python3
"""Reproducibly package only reusable plugin source. Never include workspaces."""
from pathlib import Path
import argparse
import hashlib
import json
import stat
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ROOTS = ("plugin.json", ".codex-plugin", ".agents/plugins/marketplace.json", ".gitignore", "assets", "skills", "runtime", "scripts", "tests", "docs", "README.md", "AGENTS.md", "package.json", "CHANGELOG.md")
EXCLUDED = {"__pycache__", ".DS_Store", "node_modules", ".venv", ".cache", ".git", "dist", ".work"}
EXTENSIONS = {".md", ".mjs", ".py", ".json", ".yaml", ".toml", ".lock", ".fixture", ".png"}

def package(output: Path):
    package_name = json.loads((ROOT / "plugin.json").read_text())["name"]
    if package_name != "qs-video-editor":
        raise ValueError("Unexpected plugin identity")
    prefix = package_name + "/"
    files = {}
    def visit(p):
        if p.is_symlink():
            raise ValueError(f"Symlink refused: {p.relative_to(ROOT)}")
        if p.name in EXCLUDED:
            return
        if p.is_dir():
            for child in sorted(p.iterdir()):
                visit(child)
        elif p.is_file():
            if p.name not in {".gitignore", ".python-version"} and p.suffix not in EXTENSIONS:
                raise ValueError(f"Unexpected file type: {p.relative_to(ROOT)}")
            files[p.relative_to(ROOT).as_posix()] = p.read_bytes()
        else:
            raise ValueError(f"Missing or unsupported package path: {p}")
    for relative in ROOTS:
        visit(ROOT / relative)
    manifest = {p: hashlib.sha256(data).hexdigest() for p, data in sorted(files.items())}
    files["checksums.json"] = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
    if output.exists():
        raise ValueError("Output exists; choose a new path")
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(prefix + name, (2020, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
        with zipfile.ZipFile(output) as archive:
            assert archive.testzip() is None
            for name, expected in manifest.items():
                assert hashlib.sha256(archive.read(prefix + name)).hexdigest() == expected
    except Exception:
        output.unlink(missing_ok=True)
        raise
    print(json.dumps({"output": str(output), "files": len(files), "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    package(parser.parse_args().output.resolve())
