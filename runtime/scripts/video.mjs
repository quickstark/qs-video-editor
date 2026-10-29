#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  rejectPositionals,
  printCliError,
  CliError,
  formatJson,
  findExecutable,
} from "./_shared.mjs";
import {
  PLUGIN_ROOT,
  destination,
  receipt,
  workspacePlan,
  applyWorkspace,
} from "./workspace.mjs";

const scripts = {
  probe: "probe-media.mjs",
  scaffold: "scaffold-project.mjs",
  "register-derivative": "register-derivative.mjs",
  "review-frames": "extract-review-frames.mjs",
  "validate-graphics": "validate-graphics-plan.mjs",
  promote: "promote-final.mjs",
  transcribe: "run-whisperx.mjs",
  "self-test": "self-test.mjs",
  quick: "quick.mjs",
  captions: "captions.mjs",
  evidence: "evidence.mjs",
};
const help = `QS Video Editor — one runtime, independent workspaces

Usage: node video.mjs <command> [options]
  bootstrap --workspace <dir> --profile quick|graphics|transcribe|full [--capabilities graphics,transcribe,resolve-portable] [--apply] [--json]
  migrate   --workspace <existing-dir> [--profile full] [--apply] [--json]
  check     [--workspace <dir>] [--profile quick|graphics|transcribe|full] [--capabilities <list>] [--json]
  quick     --workspace <dir> --plan <json> [--apply] [--json]
  captions  --input <mapping.json> [--output <captions.srt>]
  evidence  --project <job> [--json]
  resolve   <Resolve helper arguments>
  resolve-test
  probe|scaffold|register-derivative|review-frames|validate-graphics|promote|transcribe|self-test <helper arguments>

Bootstrap/migrate preview by default. --apply writes local setup only; no installs,
downloads, media moves, editor launch, or account changes. See docs/installation.md.
Run a subcommand with --help for its exact interface.
`;
function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || ["-h", "--help", "help"].includes(command)) {
    process.stdout.write(help);
    return 0;
  }
  const bound = process.env.VIDEO_EDITOR_WORKSPACE;
  if (bound && !["bootstrap", "migrate"].includes(command))
    receipt(destination(bound));
  if (["bootstrap", "migrate", "check"].includes(command)) {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(help);
      return 0;
    }
    const args = parseArgs(argv, {
      booleans: ["apply", "json"],
      values: ["workspace", "profile", "capabilities"],
    });
    rejectPositionals(args);
    if (command === "check") {
      const profile = args.profile ?? "quick";
      const sets = JSON.parse(
        fs.readFileSync(
          path.join(PLUGIN_ROOT, "runtime/profiles.json"),
          "utf8",
        ),
      );
      if (!sets[profile]) throw new CliError(`Unknown profile: ${profile}`);
      const workspace = args.workspace ? destination(args.workspace) : null;
      const saved = workspace ? receipt(workspace) : null;
      const caps = [
        ...new Set([
          ...sets[profile],
          ...(profile === "full" ? (saved?.capabilities ?? []) : []),
          ...(args.capabilities?.split(",") ?? []),
        ]),
      ];
      if (
        caps.some(
          (c) =>
            ![
              "quick",
              "editorial",
              "graphics",
              "transcribe",
              "resolve-portable",
            ].includes(c),
        )
      )
        throw new CliError("Unknown capability");
      const definitions = [
        ["node", process.execPath, ["--version"]],
        ["ffmpeg", "ffmpeg", ["-version"]],
        ["ffprobe", "ffprobe", ["-version"]],
      ];
      if (caps.includes("graphics"))
        definitions.push([
          "hyperframes",
          workspace
            ? path.join(
                workspace,
                "node_modules",
                ".bin",
                process.platform === "win32"
                  ? "hyperframes.cmd"
                  : "hyperframes",
              )
            : "hyperframes",
          ["--version"],
        ]);
      if (caps.includes("transcribe"))
        definitions.push(
          ["uv", "uv", ["--version"]],
          ["python3.11", "python3.11", ["--version"]],
          [
            "whisperx",
            workspace
              ? path.join(
                  workspace,
                  ".venv",
                  process.platform === "win32"
                    ? "Scripts/whisperx.exe"
                    : "bin/whisperx",
                )
              : "whisperx",
            ["--version"],
          ],
        );
      else if (caps.includes("resolve-portable"))
        definitions.push(["python3.11", "python3.11", ["--version"]]);
      const tools = definitions.map(([name, command, parameters]) => {
        const executable = findExecutable(command);
        if (!executable) return { name, available: false };
        const r = spawnSync(executable, parameters, {
          encoding: "utf8",
          timeout: 30000,
          shell: false,
          env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
        });
        return {
          name,
          available: r.status === 0,
          version:
            (r.stdout || r.stderr || "").split(/\r?\n/).find(Boolean) ?? null,
        };
      });
      const report = {
        ok: tools.every((t) => t.available),
        profile,
        capabilities: caps,
        tools,
        resolveNative: "verify live connection separately",
        installations: "not-performed",
      };
      process.stdout.write(
        args.json
          ? formatJson(report)
          : `${report.ok ? "Ready" : "Setup needed"} (${profile})\n${tools.map((t) => `${t.available ? "ok" : "missing"} ${t.name}${t.version ? `: ${t.version}` : ""}`).join("\n")}\n`,
      );
      return report.ok ? 0 : 1;
    }
    const root = destination(args.workspace ?? bound);
    if (command === "migrate" && !fs.existsSync(root))
      throw new CliError("Migration workspace does not exist");
    const plan = workspacePlan(root, {
      profile: args.profile ?? (command === "migrate" ? "full" : "quick"),
      extra: args.capabilities,
      migrate: command === "migrate",
    });
    if (args.apply) applyWorkspace(plan);
    const { files, before, next, old, ...report } = plan;
    report.action = args.apply ? "applied" : "dry-run";
    report.installations = "not-performed";
    process.stdout.write(
      args.json
        ? formatJson(report)
        : `${report.action}: ${root}\nCapabilities: ${report.capabilities.join(", ")}\nCreate: ${plan.create.length}; replace: ${plan.replace.length}; preserve: ${plan.preserve.length}; conflicts: ${plan.conflicts.length}\n${plan.conflicts.join("\n")}${plan.conflicts.length ? "\n" : ""}`,
    );
    return plan.ok ? 0 : 1;
  }
  let executable = process.execPath,
    parameters;
  if (command === "resolve" || command === "resolve-test") {
    executable = findExecutable(
      process.env.VIDEO_EDITOR_PYTHON ?? "python3.11",
    );
    if (!executable)
      throw new CliError(
        "Python 3.11 is required for portable Resolve operations; WhisperX is not",
      );
    const resolveRoot = path.join(PLUGIN_ROOT, "runtime/scripts/resolve");
    parameters =
      command === "resolve"
        ? ["-B", path.join(resolveRoot, "resolve_timeline.py"), ...argv]
        : [
            "-B",
            "-m",
            "unittest",
            "discover",
            "-s",
            path.join(resolveRoot, "tests"),
            "-p",
            "test_*.py",
            ...argv,
          ];
  } else {
    if (!scripts[command]) throw new CliError(`Unknown command: ${command}`);
    parameters = [
      fileURLToPath(new URL(scripts[command], import.meta.url)),
      ...argv,
    ];
  }
  const result = spawnSync(executable, parameters, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      HYPERFRAMES_NO_TELEMETRY: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
try {
  process.exitCode = main();
} catch (error) {
  process.exitCode = printCliError(error, {
    json: process.argv.includes("--json"),
  });
}
