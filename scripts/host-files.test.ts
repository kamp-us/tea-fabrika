// Today's tooling. These laws parse source text and never start the code in that text.
import { readFileSync } from "node:fs";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { HOST_RUN, hostFiles } from "../vitest.hostrun.ts";

const Platform = Schema.Literals(["linux", "darwin"]);
const Folder = Schema.Literals([".agents/skills/lead/scripts", "scripts", "next/apps/example/src"]);

const Safe = Schema.Literals([
  "export const answer = 42;",
  'import { spawnSync } from "node:child_process"; spawnSync("git", ["status"]);',
  'import { mkdtempSync } from "node:fs"; mkdtempSync("fixture-");',
  "const child = { kill: () => 1 }; child.kill();",
  '// process.kill(-1, "SIGTERM")\nconst text = \'process.kill(-1, "SIGTERM")\';',
]);

const Unsafe = Schema.Literals([
  'process.kill(-123, "SIGTERM");',
  'process.kill(-123, "SIGKILL");',
  'import { _electron } from "playwright"; _electron.launch();',
  'import { localInstance } from "./local-instance.ts"; localInstance("fixture");',
]);

// Plant: classify only integration/visual filenames, as the old guard did.
it.prop(
  "plain selected files with signals or real windows are refused in every project",
  {
    folder: Folder,
    platform: Platform,
    source: Unsafe,
    approved: Schema.Boolean,
  },
  ({ folder, platform, source, approved }) => {
    const path = `${folder}/ordinary.test.ts`;
    expect(hostFiles([path, path], approved ? { [HOST_RUN]: "1" } : {}, platform, () => source)).toEqual([path]);
  },
);

// Plant: refuse any process starter, which would block ordinary safe Git fixtures too.
it.prop(
  "safe explicit files stay runnable without relying on their folder or filename",
  {
    folder: Folder,
    platform: Platform,
    source: Safe,
  },
  ({ folder, platform, source }) => {
    expect(hostFiles([`${folder}/ordinary.test.ts`], {}, platform, () => source)).toEqual([]);
  },
);

// Plant: require macOS even for portable signal laws in genuine CI.
it.prop(
  "CI and remote Linux retain the existing routes",
  {
    folder: Folder,
    source: Unsafe,
    platform: Platform,
    integration: Schema.Boolean,
  },
  ({ folder, source, platform, integration }) => {
    const files = [`${folder}/ordinary.${integration ? "integration." : ""}test.ts`];
    expect(hostFiles(files, { CI: "true" }, platform, () => source)).toEqual([]);
    expect(hostFiles(files, { CLAUDE_CODE_REMOTE: "true" }, "linux", () => source)).toEqual([]);
  },
);

// Plant: drop the existing name guard while adding the source guard.
it.prop(
  "integration and visual files retain their existing local refusal",
  {
    folder: Folder,
    platform: Platform,
    kind: Schema.Literals(["integration", "visual"]),
    source: Safe,
  },
  ({ folder, platform, kind, source }) => {
    const path = `${folder}/ordinary.${kind}.test.ts`;
    expect(hostFiles([path], {}, platform, () => source)).toEqual([path]);
  },
);

// Plant: scan every repository file, including signal laws outside Vitest's selected set.
it.prop(
  "only selected files are inspected and unreadable selected source fails closed",
  {
    folder: Folder,
    platform: Platform,
    source: Safe,
  },
  ({ folder, platform, source }) => {
    const path = `${folder}/ordinary.test.ts`;
    const tree = new Map([
      [path, source],
      ["scripts/unselected.test.ts", 'process.kill(-123, "SIGTERM");'],
    ]);
    expect(hostFiles([path], {}, platform, (file) => tree.get(file)!)).toEqual([]);
    expect(() =>
      hostFiles([path], {}, platform, () => {
        throw new Error("unreadable");
      }),
    ).toThrow("unreadable");
  },
);

// Plant: retain the old filename-only guard, allowing the real regression through.
it.prop(
  "the selected box law is refused without running any of its code",
  {
    platform: Platform,
    approved: Schema.Boolean,
  },
  ({ platform, approved }) => {
    const path = ".agents/skills/lead/scripts/box.test.ts";
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(hostFiles([path], approved ? { [HOST_RUN]: "1" } : {}, platform, () => source)).toEqual([path]);
  },
);

// Plant: exempt the caps file from source checks to make its old success assertion pass.
it.prop(
  "the caps file stays protected while its pure control remains eligible",
  {
    platform: Platform,
    approved: Schema.Boolean,
  },
  ({ platform, approved }) => {
    const env = approved ? { [HOST_RUN]: "1" } : {};
    const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(hostFiles(["scripts/caps.test.ts"], env, platform, source)).toEqual(["scripts/caps.test.ts"]);
    expect(hostFiles(["vitest.hostrun.test.ts"], env, platform, source)).toEqual([]);
  },
);
