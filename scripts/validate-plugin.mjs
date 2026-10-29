#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const a = read("plugin.json"),
  b = read(".codex-plugin/plugin.json");
assert.equal(a.name, "qs-video-editor");
assert.match(a.version, /^\d+\.\d+\.\d+$/);
assert.equal(read("package.json").name, a.name);
assert.equal(read("package.json").version, a.version);
for (const key of ["name", "version", "description", "license"])
  assert.deepEqual(a[key], b[key]);
assert.deepEqual(a.extensions["com.openai"].interface, b.interface);
assert.equal(b.skills, "./skills/");
assert.ok(b.interface.shortDescription.length <= 30);
assert.equal(b.interface.category, "Creativity");
assert.equal(
  read(".agents/plugins/marketplace.json").plugins[0].source.path,
  "./",
);
assert.equal(read(".agents/plugins/marketplace.json").name, "qs-video-editor-local");
assert.equal(read(".agents/plugins/marketplace.json").plugins[0].name, a.name);
const logoPath = path.join(root, "assets/qs-video-editor.png");
const logo = fs.readFileSync(logoPath);
assert.ok(logo.length <= 5 * 1024 * 1024, "Logo exceeds 5 MiB");
assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(logo.toString("ascii", 12, 16), "IHDR");
assert.equal(logo.readUInt32BE(16), logo.readUInt32BE(20), "Logo must be square");
assert.ok(logo.readUInt32BE(16) >= 48 && logo.readUInt32BE(16) <= 4096);
assert.equal(logo[25], 6, "Logo must preserve its RGBA channel");
for (const key of ["logo", "composerIcon"])
  assert.equal(b.interface[key], "./assets/qs-video-editor.png");
const names = [
  "qs-video-edit",
  "qs-video-graphics",
  "qs-video-quick",
  "qs-video-review",
  "qs-video-setup",
  "qs-video-transcribe",
];
assert.deepEqual(fs.readdirSync(path.join(root, "skills")).sort(), names);
let links = 0;
function check(relative) {
  for (const item of fs.readdirSync(path.join(root, relative), {
    withFileTypes: true,
  })) {
    if (
      ["node_modules", ".git", "dist", "__pycache__", ".work"].includes(
        item.name,
      )
    )
      continue;
    const p = path.join(relative, item.name);
    assert.ok(!item.isSymbolicLink(), `Symlink: ${p}`);
    if (item.isDirectory()) check(p);
    else if (item.name.endsWith(".md")) {
      const text = fs.readFileSync(path.join(root, p), "utf8");
      for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = m[1].split("#")[0];
        if (
          !href ||
          /^(https?:|mailto:|plugin:|skill:)/.test(href) ||
          href.includes("<")
        )
          continue;
        const target = path.resolve(root, path.dirname(p), href);
        assert.ok(fs.existsSync(target), `Broken link in ${p}: ${href}`);
        links++;
      }
    }
  }
}
for (const name of names) {
  const text = fs.readFileSync(
    path.join(root, "skills", name, "SKILL.md"),
    "utf8",
  );
  assert.ok(text.startsWith(`---\nname: ${name}\n`));
  const yaml = fs.readFileSync(
    path.join(root, "skills", name, "agents/openai.yaml"),
    "utf8",
  );
  assert.ok(yaml.includes(`$${name}`), `Default prompt must mention $${name}`);
  for (const key of ["icon_small", "icon_large"]) {
    const entry = yaml.match(new RegExp(`^  ${key}: (\".*\")$`, "m"));
    assert.ok(entry, `Missing ${key} in ${name}`);
    const icon = JSON.parse(entry[1]);
    assert.equal(path.resolve(root, "skills", name, icon), logoPath);
  }
}
check(".");
console.log(
  `Plugin metadata, six skills, and ${links} local documentation links verified.`,
);
