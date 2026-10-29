import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  workspacePlan,
  applyWorkspace,
  destination,
  receipt,
  fileHash,
} from "../runtime/scripts/workspace.mjs";
import { mapCaptions } from "../runtime/scripts/captions.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function temp(t) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), "qs-video-editor-test-"));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
}
function run(file, args, options = {}) {
  return spawnSync(process.execPath, [path.join(root, file), ...args], {
    encoding: "utf8",
    ...options,
  });
}
test("bootstrap plan creates nothing; apply, rerun and restore preserve local edits", (t) => {
  const base = temp(t),
    ws = path.join(base, "a workspace");
  const plan = workspacePlan(ws);
  assert.equal(fs.existsSync(ws), false);
  assert.equal(plan.ok, true);
  applyWorkspace(plan);
  assert.equal(fs.existsSync(path.join(ws, "uv.lock")), false);
  assert.equal(fs.existsSync(path.join(ws, "package-lock.json")), false);
  const second = workspacePlan(ws);
  assert.equal(second.create.length, 0);
  assert.equal(second.receiptChange, false);
  const pkg = path.join(ws, "package.json");
  fs.appendFileSync(pkg, "\n");
  fs.unlinkSync(path.join(ws, ".video-editor/run.mjs"));
  const restore = workspacePlan(ws);
  applyWorkspace(restore);
  assert.ok(fs.readFileSync(pkg, "utf8").endsWith("\n\n"));
  const actual = spawnSync(
    process.execPath,
    [path.join(ws, ".video-editor/run.mjs"), "--help"],
    { cwd: base, encoding: "utf8" },
  );
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(receipt(ws).capabilities.includes("quick"), true);
});
test("first-run conflict and symlink escape block writes", (t) => {
  const ws = temp(t);
  fs.writeFileSync(path.join(ws, "package.json"), '{"private":true}');
  assert.equal(workspacePlan(ws).ok, false);
  assert.equal(fs.existsSync(path.join(ws, ".video-editor")), false);
  fs.symlinkSync(os.tmpdir(), path.join(ws, ".video-editor"));
  assert.throws(() => workspacePlan(ws), /symbolic-link/);
});
test("independent workspace identities and unknown profiles", (t) => {
  const ws = temp(t);
  const a = workspacePlan(path.join(ws, "a")),
    b = workspacePlan(path.join(ws, "b"));
  applyWorkspace(a);
  applyWorkspace(b);
  assert.notEqual(
    receipt(a.workspace).workspaceId,
    receipt(b.workspace).workspaceId,
  );
  assert.throws(
    () => workspacePlan(path.join(ws, "c"), { profile: "everything" }),
    /Unknown profile/,
  );
  assert.throws(() => destination(root), /independent/);
});
test("add graphics profile without Python; keep custom npm scripts", (t) => {
  const ws = temp(t);
  applyWorkspace(workspacePlan(ws));
  const pkg = JSON.parse(fs.readFileSync(path.join(ws, "package.json")));
  pkg.scripts.custom = "echo hello";
  fs.writeFileSync(path.join(ws, "package.json"), JSON.stringify(pkg));
  applyWorkspace(workspacePlan(ws, { profile: "graphics" }));
  const next = JSON.parse(fs.readFileSync(path.join(ws, "package.json")));
  assert.equal(next.scripts.custom, "echo hello");
  assert.ok(next.devDependencies.hyperframes);
  assert.ok(fs.existsSync(path.join(ws, "package-lock.json")));
  assert.equal(fs.existsSync(path.join(ws, "uv.lock")), false);
});
test("migration changes caller bindings only; locks and project approval bytes stay intact", (t) => {
  const ws = temp(t);
  fs.mkdirSync(path.join(ws, "projects", "old", "reviews"), {
    recursive: true,
  });
  const approval = path.join(
    ws,
    "projects",
    "old",
    "reviews",
    "approval-log.json",
  );
  fs.writeFileSync(
    approval,
    '{"approvals":[{"status":"approved","scope":"export"}]}',
  );
  fs.writeFileSync(
    path.join(ws, "package.json"),
    JSON.stringify({
      private: true,
      scripts: {
        "video:probe": "node .agents/skills/edit-video/scripts/probe-media.mjs",
        custom: "echo preserved",
      },
    }),
  );
  fs.writeFileSync(path.join(ws, "uv.lock"), "custom lock");
  const before = fileHash(approval);
  const plan = workspacePlan(ws, { profile: "full", migrate: true });
  assert.equal(plan.replace.includes("package.json"), true);
  assert.equal(fs.existsSync(path.join(ws, ".video-editor")), false);
  applyWorkspace(plan);
  assert.equal(fileHash(approval), before);
  assert.equal(
    fs.readFileSync(path.join(ws, "uv.lock"), "utf8"),
    "custom lock",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(ws, "package.json"))).scripts.custom,
    "echo preserved",
  );
  assert.equal(
    workspacePlan(ws, { profile: "full", migrate: true }).replace.length,
    0,
  );
});
test("changed config and exclusive setup lock block stale apply", (t) => {
  const ws = temp(t);
  fs.writeFileSync(path.join(ws, "package.json"), '{"scripts":{}}');
  const p = workspacePlan(ws, { migrate: true });
  fs.writeFileSync(
    path.join(ws, "package.json"),
    '{"scripts":{"new":"value"}}',
  );
  assert.throws(() => applyWorkspace(p), /changed after planning/);
  const p2 = workspacePlan(ws, { migrate: true });
  fs.writeFileSync(path.join(ws, ".video-editor/setup.lock"), "owner");
  assert.throws(() => applyWorkspace(p2), /locked/);
});
test("captions remap reorder/reuse at rational frame rate and flag word cuts", () => {
  const input = {
    schemaVersion: 1,
    frameRateNumerator: 24000,
    frameRateDenominator: 1001,
    words: [
      { sourceId: "a", text: "One", start: 0.5, end: 0.8 },
      { sourceId: "a", text: "Two", start: 1, end: 1.3 },
      { sourceId: "a", text: "Unknown" },
    ],
    clips: [
      {
        sourceId: "a",
        sourceInFrame: 0,
        sourceOutFrame: 24,
        timelineStartFrame: 48,
      },
      {
        sourceId: "a",
        sourceInFrame: 0,
        sourceOutFrame: 24,
        timelineStartFrame: 0,
      },
    ],
  };
  const result = mapCaptions(input);
  assert.equal(result.cues.length, 4);
  assert.ok(result.cues[2].start > 2.5);
  assert.ok(result.warnings.some((w) => w.reason === "unaligned-word"));
  assert.ok(result.warnings.some((w) => w.reason === "cut-intersects-word"));
  assert.equal(input.words[0].start, 0.5);
});
test("real-media batch smoke: dry-run, safe apply, resume, changed source, collision", (t) => {
  const ws = temp(t);
  const ff = spawnSync("ffmpeg", ["-version"]);
  if (ff.error) {
    t.skip("FFmpeg unavailable");
    return;
  }
  const source = path.join(ws, "source $(touch NEVER).mp4");
  const created = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24000/1001",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);
  const sourceDigest = fileHash(source),
    plan = path.join(ws, "plan.json");
  fs.writeFileSync(
    plan,
    JSON.stringify({
      schemaVersion: 1,
      operations: [
        {
          id: "one",
          input: source,
          output: "outputs/small.mp4",
          type: "resize",
          width: 80,
        },
      ],
    }),
  );
  const dry = run("runtime/scripts/quick.mjs", [
    "--workspace",
    ws,
    "--plan",
    plan,
    "--json",
  ]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(fs.existsSync(path.join(ws, "outputs")), false);
  const resolved = JSON.parse(dry.stdout).resolvedPlan;
  fs.writeFileSync(plan, JSON.stringify(resolved));
  const apply = run("runtime/scripts/quick.mjs", [
    "--workspace",
    ws,
    "--plan",
    plan,
    "--apply",
    "--json",
  ]);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(fileHash(source), sourceDigest);
  assert.equal(fs.existsSync(path.join(ws, "NEVER")), false);
  assert.equal(JSON.parse(apply.stdout).operations[0].streams[0].width, 80);
  const again = run("runtime/scripts/quick.mjs", [
    "--workspace",
    ws,
    "--plan",
    plan,
    "--apply",
    "--json",
  ]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).operations[0].reused, true);
  fs.appendFileSync(source, "changed");
  const changed = run("runtime/scripts/quick.mjs", [
    "--workspace",
    ws,
    "--plan",
    plan,
    "--apply",
  ]);
  assert.notEqual(changed.status, 0);
  resolved.operations.push({ ...resolved.operations[0], id: "two" });
  resolved.operations.forEach((o) => delete o.inputSha256);
  fs.writeFileSync(plan, JSON.stringify(resolved));
  const conflict = run("runtime/scripts/quick.mjs", [
    "--workspace",
    ws,
    "--plan",
    plan,
  ]);
  assert.notEqual(conflict.status, 0);
});
test("Resolve rejects a stale expected timeline before attempting editor connection", () => {
  const r = spawnSync(
    "python3.11",
    [
      "-B",
      path.join(root, "runtime/scripts/resolve/resolve_timeline.py"),
      "--timeline",
      path.join(root, "runtime/scripts/resolve/fixtures/timeline.json"),
      "--expected-timeline-sha256",
      "0".repeat(64),
      "--validate-only",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /changed since planning/);
});
test("explicit update and rollback preserve workspace identity, approvals, locks and newer outputs", (t) => {
  const base = temp(t), previous = path.join(base, "previous"), ws = path.join(base, "workspace");
  fs.mkdirSync(previous);
  fs.cpSync(path.join(root, "runtime"), path.join(previous, "runtime"), { recursive: true });
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "plugin.json")));
  metadata.name = "video-editor";
  metadata.version = "0.1.0";
  fs.writeFileSync(path.join(previous, "plugin.json"), JSON.stringify(metadata));
  fs.writeFileSync(path.join(previous, "runtime/references/previous-release.fixture"), "Previous release fixture\n");
  const call = (plugin, args) => spawnSync(process.execPath,
    [path.join(plugin, "runtime/scripts/video.mjs"), ...args], { encoding: "utf8" });
  let result = call(previous, ["bootstrap", "--workspace", ws, "--profile", "full", "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(fs.readFileSync(path.join(ws, ".video-editor/workspace.json")));
  const protectedFiles = {
    "projects/fixture/raw/source.fixture": "Original media fixture\n",
    "projects/fixture/reviews/approval-log.json": '{"approvedRevision":"fixture-1","status":"approved"}\n',
    "package-lock.json": '{"lockfileVersion":3,"name":"custom-project"}\n',
    "uv.lock": "# Project-owned pinned environment\n",
  };
  for (const [relative, data] of Object.entries(protectedFiles)) {
    fs.mkdirSync(path.dirname(path.join(ws, relative)), { recursive: true });
    fs.writeFileSync(path.join(ws, relative), data);
  }
  result = call(root, ["check", "--workspace", ws, "--profile", "full", "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime differs/);
  result = call(root, ["migrate", "--workspace", ws, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const updated = receipt(ws);
  assert.equal(updated.workspaceId, saved.workspaceId);
  assert.equal(updated.pluginVersion, JSON.parse(fs.readFileSync(path.join(root, "plugin.json"))).version);
  assert.notEqual(updated.runtimeDigest, saved.runtimeDigest);
  const newer = path.join(ws, "projects/fixture/outputs/created-after-update.fixture");
  fs.mkdirSync(path.dirname(newer), { recursive: true });
  fs.writeFileSync(newer, "New output must survive rollback\n");
  result = call(previous, ["migrate", "--workspace", ws, "--apply", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const rolledBack = JSON.parse(fs.readFileSync(path.join(ws, ".video-editor/workspace.json")));
  assert.equal(rolledBack.workspaceId, saved.workspaceId);
  assert.equal(rolledBack.pluginVersion, saved.pluginVersion);
  assert.equal(rolledBack.runtimeDigest, saved.runtimeDigest);
  assert.equal(rolledBack.pluginRoot, fs.realpathSync(previous));
  for (const [relative, data] of Object.entries(protectedFiles))
    assert.equal(fs.readFileSync(path.join(ws, relative), "utf8"), data);
  assert.equal(fs.readFileSync(newer, "utf8"), "New output must survive rollback\n");
  result = call(previous, ["check", "--workspace", ws, "--profile", "full", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.readdirSync(path.join(ws, ".video-editor/backups")).length >= 2);
});
test("package is reproducible, contains checksums and logo, and extracted source validates", (t) => {
  const base = temp(t),
    a = path.join(base, "a.zip"),
    b = path.join(base, "b.zip");
  for (const p of [a, b]) {
    const r = spawnSync(
      "python3.11",
      [path.join(root, "scripts/package-plugin.py"), "--output", p],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(fileHash(a), fileHash(b));
  const code =
    'import zipfile,hashlib,json,sys; z=zipfile.ZipFile(sys.argv[1]); m=json.loads(z.read("qs-video-editor/checksums.json")); assert "assets/qs-video-editor.png" in m; assert all(hashlib.sha256(z.read("qs-video-editor/"+p)).hexdigest()==h for p,h in m.items()); assert not any("node_modules/" in p or "/projects/" in p or "/.git/" in p for p in z.namelist()); z.extractall(sys.argv[2])';
  const extracted = path.join(base, "extracted");
  const e = spawnSync("python3.11", ["-c", code, a, extracted], {
    encoding: "utf8",
  });
  assert.equal(e.status, 0, e.stderr);
  const v = spawnSync(
    process.execPath,
    [path.join(extracted, "qs-video-editor/scripts/validate-plugin.mjs")],
    { encoding: "utf8" },
  );
  assert.equal(v.status, 0, v.stderr);
  const help = spawnSync(
    process.execPath,
    [path.join(extracted, "qs-video-editor/runtime/scripts/video.mjs"), "--help"],
    { cwd: base, encoding: "utf8" },
  );
  assert.equal(help.status, 0, help.stderr);
});
