#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,
  rejectPositionals,
  readJsonFile,
  printCliError,
  formatJson,
  CliError,
} from "./_shared.mjs";
import { fileHash, localPath } from "./workspace.mjs";
try {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["help", "json"],
    values: ["project"],
  });
  rejectPositionals(args);
  if (args.help)
    process.stdout.write(
      "Usage: evidence.mjs --project <job> [--json]\nRead-only compact source-linked project/timeline/stage evidence with file hashes. No visual, listening, or import check is inferred.\n",
    );
  else {
    if (!args.project) throw new CliError("--project is required");
    const root = path.resolve(args.project),
      records = {};
    const names = [
      "project.json",
      "timeline/timeline.json",
      "reviews/qa-report.json",
      "reviews/approval-log.json",
    ];
    const manifestDir = localPath(root, "manifests");
    if (fs.existsSync(manifestDir))
      for (const name of fs.readdirSync(manifestDir).sort())
        if (name.endsWith(".json") && !name.endsWith(".schema.json"))
          names.push(`manifests/${name}`);
    for (const relative of names) {
      const p = localPath(root, relative);
      if (!fs.existsSync(p)) {
        records[relative] = { status: "missing" };
        continue;
      }
      const value = readJsonFile(p);
      records[relative] = {
        sha256: fileHash(p),
        status: value.status ?? "recorded",
        ...(relative === "project.json"
          ? { id: value.id, kind: value.kind }
          : {}),
        ...(relative.includes("timeline.json")
          ? {
              format: value.format,
              revision: value.revision ?? null,
              clips: [
                ...(value.videoTracks ?? []),
                ...(value.audioTracks ?? []),
              ].flatMap((t) =>
                (t.items ?? []).map((c) => ({
                  id: c.id,
                  sourceId: c.sourceId,
                  sourcePath: c.sourcePath,
                  sourceInFrame: c.sourceInFrame,
                  sourceOutFrame: c.sourceOutFrame,
                  timelineStartFrame: c.timelineStartFrame,
                  timelineEndFrame: c.timelineEndFrame,
                })),
              ),
            }
          : {}),
      };
    }
    const result = {
      schemaVersion: 1,
      records,
      coverage: {
        visual: "not-run",
        motion: "not-run",
        listening: "not-run",
        editorImport: "not-run",
      },
      guidance:
        "Use source IDs and spans; inspect only decision-critical frames/audio next. Hashes establish identity, not editorial correctness.",
    };
    process.stdout.write(formatJson(result));
  }
} catch (e) {
  process.exitCode = printCliError(e, {
    json: process.argv.includes("--json"),
  });
}
