import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CliError,
  refuseSymlinkChain,
  assertInside,
  formatJson,
  readJsonFile,
} from "./_shared.mjs";

export const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function fileHash(p) {
  const h = createHash("sha256"),
    fd = fs.openSync(p, "r"),
    buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      h.update(buffer.subarray(0, count));
    return h.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}
export const RECEIPT = ".video-editor/workspace.json";
const profiles = readJsonFile(path.join(PLUGIN_ROOT, "runtime/profiles.json"));
const capabilities = new Set([
  "quick",
  "graphics",
  "transcribe",
  "editorial",
  "resolve-portable",
]);
export function runtimeDigest(root = PLUGIN_ROOT) {
  const result = [];
  function visit(relative) {
    for (const item of fs
      .readdirSync(path.join(root, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (["__pycache__", ".DS_Store"].includes(item.name)) continue;
      const next = path.join(relative, item.name);
      if (item.isSymbolicLink())
        throw new CliError("Runtime symlinks are not supported");
      if (item.isDirectory()) visit(next);
      else if (item.isFile())
        result.push([
          next.split(path.sep).join("/"),
          fileHash(path.join(root, next)),
        ]);
    }
  }
  visit("runtime");
  return digest(JSON.stringify(result));
}
export function destination(value) {
  if (!value) throw new CliError("Pass --workspace <directory>");
  let root = path.resolve(value),
    parent = root;
  const rest = [];
  while (!fs.existsSync(parent)) {
    rest.unshift(path.basename(parent));
    parent = path.dirname(parent);
  }
  if (!fs.statSync(parent).isDirectory())
    throw new CliError("Workspace parent is not a directory");
  refuseSymlinkChain(parent, root, "workspace");
  root = path.join(fs.realpathSync(parent), ...rest);
  const plugin = fs.realpathSync(PLUGIN_ROOT);
  const contains = (a, b) => {
    const r = path.relative(a, b);
    return (
      r === "" ||
      (r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r))
    );
  };
  if (contains(plugin, root) || contains(root, plugin))
    throw new CliError("Workspace and plugin must be independent directories");
  return root;
}
export function localPath(root, relative) {
  const target = path.resolve(root, relative);
  assertInside(root, target, "workspace path");
  if (target === root) throw new CliError("Expected a file path");
  refuseSymlinkChain(root, target, "workspace path");
  return target;
}
export function receipt(root, { verify = true } = {}) {
  const p = localPath(root, RECEIPT);
  if (!fs.existsSync(p)) return null;
  const value = readJsonFile(p);
  if (
    value.schemaVersion !== 1 ||
    value.plugin !== "video-editor" ||
    !Array.isArray(value.capabilities)
  )
    throw new CliError("Unsupported workspace receipt");
  if (
    verify &&
    (value.runtimeDigest !== runtimeDigest() ||
      value.pluginVersion !==
        readJsonFile(path.join(PLUGIN_ROOT, "plugin.json")).version)
  )
    throw new CliError(
      "Workspace runtime differs from its binding; restore the bound version or review a migration",
    );
  return value;
}
export function atomicJson(root, relative, value) {
  const p = localPath(root, relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, formatJson(value), { flag: "wx" });
    fs.renameSync(tmp, p);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
const launcher = `import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receipt=JSON.parse(fs.readFileSync(path.join(workspace,'.video-editor/workspace.json'),'utf8'));
const entry=path.join(receipt.pluginRoot,'runtime/scripts/video.mjs');
if(!fs.existsSync(entry)){process.stderr.write('Bound Video Editor runtime unavailable. Restore its recorded version, then migrate the binding.\\n');process.exit(2);}
const result=spawnSync(process.execPath,[entry,...process.argv.slice(2)],{cwd:workspace,env:{...process.env,VIDEO_EDITOR_WORKSPACE:workspace,EDIT_VIDEO_WORKSPACE:workspace},stdio:'inherit',shell:false});
if(result.error)process.stderr.write(result.error.message+'\\n');
process.exitCode=result.status??1;
`;
const commands = {
  check: "check",
  "self-test": "self-test",
  scaffold: "scaffold",
  probe: "probe",
  "derivative:register": "register-derivative",
  "review:frames": "review-frames",
  "graphics:validate": "validate-graphics",
  promote: "promote",
  transcribe: "transcribe",
  "resolve:test": "resolve-test",
  "resolve:validate": "resolve --validate-only",
  "resolve:plan": "resolve",
  bootstrap: "bootstrap",
  quick: "quick",
  captions: "captions",
  evidence: "evidence",
};
export function workspacePlan(
  root,
  { profile = "quick", extra = "", migrate = false } = {},
) {
  if (!profiles[profile]) throw new CliError(`Unknown profile: ${profile}`);
  const old = receipt(root, { verify: false });
  const additions = extra ? extra.split(",") : [];
  for (const c of additions)
    if (!capabilities.has(c)) throw new CliError(`Unknown capability: ${c}`);
  const enabled = [
    ...new Set([
      ...(old?.capabilities ?? []),
      ...profiles[profile],
      ...additions,
    ]),
  ].sort();
  if (
    old &&
    (old.runtimeDigest !== runtimeDigest() ||
      old.pluginVersion !==
        readJsonFile(path.join(PLUGIN_ROOT, "plugin.json")).version) &&
    !migrate
  )
    throw new CliError(
      "Different runtime binding; use migrate after reviewing its plan",
    );
  const files = new Map([[".video-editor/run.mjs", launcher]]);
  const pkgPath = localPath(root, "package.json");
  const originalPkg = fs.existsSync(pkgPath) ? readJsonFile(pkgPath) : null;
  let pkg = originalPkg
    ? structuredClone(originalPkg)
    : {
        name: "codex-video-workspace",
        version: "0.1.0",
        private: true,
        engines: { node: ">=22" },
        scripts: {},
      };
  pkg.scripts ??= {};
  if (migrate && originalPkg) {
    for (const [key, value] of Object.entries(pkg.scripts)) {
      if (
        typeof value === "string" &&
        value.includes(".agents/skills/edit-video/scripts/")
      ) {
        const suffix = key.replace(/^video:/, "");
        if (commands[suffix])
          pkg.scripts[key] = `node .video-editor/run.mjs ${commands[suffix]}`;
        else throw new CliError(`Unmapped legacy caller: ${key}`);
      }
    }
  }
  for (const [name, command] of Object.entries(commands))
    pkg.scripts[`video:${name}`] ??= `node .video-editor/run.mjs ${command}`;
  if (
    enabled.includes("graphics") &&
    (!originalPkg ||
      (old && !fs.existsSync(localPath(root, "package-lock.json"))))
  ) {
    const base = readJsonFile(
      path.join(PLUGIN_ROOT, "runtime/templates/package.json"),
    );
    if (!originalPkg) {
      pkg.name = base.name;
      pkg.version = base.version;
    }
    pkg.devDependencies = { ...pkg.devDependencies, ...base.devDependencies };
    for (const [k, v] of Object.entries(base.scripts))
      if (k.startsWith("hyperframes:")) pkg.scripts[k] = v;
  }
  if (enabled.includes("graphics")) {
    const baseline = readJsonFile(
      path.join(PLUGIN_ROOT, "runtime/templates/package.json"),
    );
    if (!pkg.devDependencies?.hyperframes) {
      if (originalPkg)
        throw new CliError(
          "Existing package needs a reviewed graphics dependency/lock merge; no automatic replacement",
        );
    }
    const lock = readJsonFile(
      path.join(PLUGIN_ROOT, "runtime/templates/package-lock.json"),
    );
    lock.name = pkg.name;
    lock.version = pkg.version;
    lock.packages[""].name = pkg.name;
    lock.packages[""].version = pkg.version;
    files.set("package-lock.json", formatJson(lock));
  }
  if (enabled.includes("transcribe")) {
    for (const p of ["pyproject.toml", "uv.lock", ".python-version"])
      files.set(
        p,
        fs.readFileSync(path.join(PLUGIN_ROOT, "runtime/templates", p), "utf8"),
      );
    pkg.scripts["video:python:sync"] ??=
      "uv sync --locked --python 3.11 --no-python-downloads";
  }
  files.set("package.json", formatJson(pkg));
  if (enabled.includes("editorial") || enabled.includes("graphics")) {
    for (const p of ["AGENTS.md", "brand.md"])
      files.set(
        p,
        fs.readFileSync(path.join(PLUGIN_ROOT, "runtime/templates", p), "utf8"),
      );
    function styles(relative) {
      for (const e of fs.readdirSync(
        path.join(PLUGIN_ROOT, "runtime/templates", relative),
        { withFileTypes: true },
      )) {
        const p = path.join(relative, e.name);
        if (e.isDirectory()) styles(p);
        else
          files.set(
            p,
            fs.readFileSync(
              path.join(PLUGIN_ROOT, "runtime/templates", p),
              "utf8",
            ),
          );
      }
    }
    styles("styles");
  }
  const create = [],
    replace = [],
    preserve = [],
    conflicts = [],
    before = {};
  for (const [relative, content] of files) {
    const p = localPath(root, relative);
    if (!fs.existsSync(p)) create.push(relative);
    else if (!fs.statSync(p).isFile()) conflicts.push(relative);
    else if (fs.readFileSync(p, "utf8") !== content) {
      if (
        migrate &&
        ["package.json", ".video-editor/run.mjs"].includes(relative)
      ) {
        replace.push(relative);
        before[relative] = fs.readFileSync(p).toString("base64");
      } else if (
        relative === "package.json" &&
        old &&
        additions.length +
          profiles[profile].filter((c) => !old.capabilities.includes(c))
            .length >
          0
      ) {
        replace.push(relative);
        before[relative] = fs.readFileSync(p).toString("base64");
      } else if (old || migrate) preserve.push(relative);
      else conflicts.push(relative);
    }
  }
  const next = {
    schemaVersion: 1,
    plugin: "video-editor",
    workspaceId: old?.workspaceId ?? randomUUID(),
    pluginVersion: readJsonFile(path.join(PLUGIN_ROOT, "plugin.json")).version,
    pluginRoot: PLUGIN_ROOT,
    runtimeDigest: runtimeDigest(),
    capabilities: enabled,
    templateHashes: Object.fromEntries(
      [...files].map(([p, c]) => [p, digest(c)]),
    ),
    ...(old?.migration ? { migration: old.migration } : {}),
  };
  if (migrate && !old)
    next.migration = {
      from: "legacy-edit-video",
      protectedProjectData: "unchanged",
    };
  const receiptSame = old && JSON.stringify(old) === JSON.stringify(next);
  return {
    ok: conflicts.length === 0,
    workspace: root,
    profile,
    capabilities: enabled,
    create,
    replace,
    preserve,
    conflicts,
    receiptChange: !receiptSame,
    files,
    before,
    next,
    old,
  };
}
export function applyWorkspace(plan) {
  if (!plan.ok)
    throw new CliError(
      `Conflicting workspace files: ${plan.conflicts.join(", ")}`,
    );
  fs.mkdirSync(localPath(plan.workspace, ".video-editor"), { recursive: true });
  const lock = localPath(plan.workspace, ".video-editor/setup.lock");
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch {
    throw new CliError(
      "Workspace setup locked; inspect the owning process before retrying",
    );
  }
  try {
    fs.writeFileSync(fd, formatJson({ pid: process.pid }));
    // Recheck all planned destinations after acquiring the exclusive lock.
    for (const relative of plan.create)
      if (fs.existsSync(localPath(plan.workspace, relative)))
        throw new CliError(`Target appeared after planning: ${relative}`);
    for (const [relative, bytes] of Object.entries(plan.before))
      if (
        fs
          .readFileSync(localPath(plan.workspace, relative))
          .toString("base64") !== bytes
      )
        throw new CliError(`File changed after planning: ${relative}`);
    if (plan.replace.length || (plan.old && plan.receiptChange))
      atomicJson(plan.workspace, `.video-editor/backups/${randomUUID()}.json`, {
        schemaVersion: 1,
        files: plan.before,
        receipt: plan.old,
      });
    for (const relative of [...plan.create, ...plan.replace]) {
      const p = localPath(plan.workspace, relative);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (plan.create.includes(relative))
        fs.writeFileSync(p, plan.files.get(relative), { flag: "wx" });
      else {
        const tmp = `${p}.${randomUUID()}.tmp`;
        try {
          fs.writeFileSync(tmp, plan.files.get(relative), { flag: "wx" });
          fs.renameSync(tmp, p);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      }
    }
    if (plan.receiptChange) atomicJson(plan.workspace, RECEIPT, plan.next);
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}
