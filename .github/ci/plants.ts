import { readFileSync } from "node:fs";
// Today's manual lead tooling: the repo's plant catalog (decision 0600) and the edge that runs it.
//
// A plant is a break put once into product code to show a law can fail (decision 0093). Here each one
// names a Stryker-made mutant by its code shape (file, mutator, the node's text, Stryker's
// replacement) and the law that must kill it, and `@kalfa/quality/stryker` finds that one place,
// runs Stryker against the law's file alone, and answers `killed` only when the law is among the
// tests that failed. No byte offset or commit is pinned, so a blank line or a squash merge leaves a
// plant as it was.
//
//   node .github/ci/plants.ts stryker plant host-pnpm-path --out runs/plants/host-pnpm-path.json
//   node .github/ci/plants.ts stryker survey <file> --law <test file> --from 120 --to 135
//
// The catalog holds the five cases of the old runner (plant-cases.ts, ticket 1133) that put a break
// into product code and have a Stryker mutator. The ten that edited a test file's own fake are
// dropped: a plant breaks the product, never the exam (0093, 0600). `host-discovery-timeout` moves
// code, which no Stryker mutator does, so it keeps its recorded one-time plant and is left out.
//
// This file is the repo's edge. The package holds no repo path and no host guard; this file hands it
// the repo's settings and runs the repo's own guard (0594) on the law's test file first: a law that
// starts a real resource never runs on a person's laptop, here or anywhere else.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { quality } from "@kalfa/quality/cli";
import { plant } from "@kalfa/quality/stryker";
import { provider } from "@kalfa/quality/stryker/Settings";
import { ConfigProvider, Effect, Schema } from "effect";
import { Command } from "effect/cli";
import { hostFiles } from "../../vitest.hostrun.ts";

/** The law that four of the five plants must fail: an explicit pin keeps the pnpm and Node the pin names. */
const PIN = {
  file: ".agents/skills/lead/scripts/flow/host.test.ts",
  name: "the host step's outcomes > scenario: an explicit pin keeps direct and nested pnpm on that Node, even when the manifest differs",
};

/** The law of the real checklist delivery: every view carries its process's pid. */
const PID = {
  file: "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts",
  name: "L13: notices name their process > each view.whole and view.patch for checklist:1 carries its pid and the update its Process published",
};

const catalog = [
  // The old case dropped `pid: active` from the published update. Stryker's nearest mutant is the whole
  // object, `{}`, which loses the update with the pid; the law's failure is the same one, the client
  // never hears the checklist's views. The law is in next/apps/fabrika and the target in
  // next/packages/libfabrika, two packages, so this plant needs `inPlace` (the workflow sets it).
  plant({
    name: "checklist-pid",
    file: "next/packages/libfabrika/src/cloudflare/runtime.ts",
    mutator: "ObjectLiteral",
    original: "{ ...update, pid: active }",
    replacement: "{}",
    law: PID,
  }),
  // The old case swapped the pinned environment for the parent's. With `node === null` always true,
  // the line's child gets the parent's environment and the pin is never applied.
  plant({
    name: "host-pin",
    file: ".agents/skills/lead/scripts/flow/host.ts",
    mutator: "ConditionalExpression",
    original: "node === null",
    replacement: "true",
    law: PIN,
  }),
  // The old case dropped the requested pin for the manifest's. `&&` for `??` returns the manifest's
  // pin whenever a pin was requested.
  plant({
    name: "host-requested-pin",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    mutator: "LogicalOperator",
    original: "requested ?? (yield* repoNode(main))",
    replacement: "requested && (yield* repoNode(main))",
    law: PIN,
  }),
  // The old case left pnpm off the PATH.
  plant({
    name: "host-pnpm-path",
    file: ".agents/skills/lead/scripts/boxnode.ts",
    mutator: "ConditionalExpression",
    original: "pnpm === null",
    replacement: "true",
    law: PIN,
  }),
  // The old case swapped the order of the parent's environment and the pin's. An emptied object is
  // wider: the parent's values and the pin's own are both lost.
  plant({
    name: "host-env-order",
    file: ".agents/skills/lead/scripts/flow/host.ts",
    mutator: "ObjectLiteral",
    original: "{ ...process.env, ...env }",
    replacement: "{}",
    law: PIN,
  }),
];

export default catalog;

/** What the repo hands the package: the three settings that are ours (AGENTS.md's caps and the folders Stryker must not copy). */
const repo = { quality: { stryker: { catalog: import.meta.filename, nice: 15, ignore: [".claude", "runs"] } } };

type Env = Readonly<Record<string, string | undefined>>;

/** The run is refused here (0594): its law reaches a real resource and this machine is not one that may start it. */
class HostOnly extends Schema.TaggedError<HostOnly, { readonly brand: unique symbol }>()("HostOnly", {
  files: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return [
      `Local host-only plant run refused (decision 0178). This plant's law reaches a real resource: ${this.files.join(", ")}`,
      "Use eligible disposable CI for the selected laws (0594): gh workflow run plants.yaml -f plant=<name>.",
    ].join("\n");
  }
}

/** The test file a command line names, for the host guard: a plant's law, or `survey`'s `--law`. */
const lawOf = (args: ReadonlyArray<string>) => {
  const [, verb, subject] = args;
  const flag = args.indexOf("--law");

  return verb === "survey"
    ? flag < 0
      ? undefined
      : args[flag + 1]
    : catalog.find(({ name }) => name === subject)?.law.file;
};

/** One command line, `args` as typed after the script's name, with the environment and platform the guard and the settings read. */
export const run = (args: ReadonlyArray<string>, env: Env, platform: NodeJS.Platform) =>
  Effect.suspend(() => {
    const law = lawOf(args);
    // 0594: refuse here, with the same message the test runner prints, before anything starts.
    const refused = law === undefined ? [] : hostFiles([law], env, platform, (path) => readFileSync(path, "utf8"));

    return refused.length > 0
      ? Effect.fail(new HostOnly({ files: refused }))
      : Command.runWith(quality, { version: "0.0.0" })(args).pipe(
          Effect.provide(ConfigProvider.layer(provider(env, repo))),
        );
  });

if (import.meta.main) {
  NodeRuntime.runMain(
    run(process.argv.slice(2), process.env, process.platform).pipe(Effect.provide(NodeServices.layer)),
  );
}
