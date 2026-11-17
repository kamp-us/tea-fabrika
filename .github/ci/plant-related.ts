// Today's automatic CI. Each existing integration leg runs its assigned checklist cases serially.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, DateTime, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Digest } from "effect/crypto";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import vitest from "vitest/package.json" with { type: "json" };
import { parse } from "yaml";
import { cases, derive, prepare, Request } from "./plant-cases.ts";
import { Model } from "./plant-machine.ts";
import { execute, ExerciseError } from "./plant.ts";

export const fixture = "next/apps/fabrika/src/checklist-instance.laws.integration.test.ts";

const origin = "a062f7a2515aa1917dfae05d3af95e3705b88812";

const catalog = cases["checklist-body"].source;

export const checklistCases = Schema.decodeUnknownSync(Schema.Array(Request.fields.case))(Object.keys(cases)).filter(
  (key) => key.startsWith("checklist-"),
);

const keys = checklistCases;

/** The nine pinned cases use the reporter's existing causal gate; PID adds its current frame. */

export const accepted = (key: Request["case"], model: Model): boolean => {
  if (!keys.includes(key) || model._tag !== "recorded") {
    return false;
  }

  return (
    key !== "checklist-pid" ||
    (model.broken.diagnostic === "AssertionError: a notice names its process" &&
      model.broken.assertion?.line === 828 &&
      model.broken.assertion.column === 68)
  );
};

/** No broader CI change or global trigger alone requests these fixed fixture faults. */

export const wanted = (paths: readonly string[] | null): boolean =>
  paths === null ||
  paths.some(
    (path) => path === fixture || /^\.github\/ci\/plant(?:-cases|-errors|-machine|-reporter|-related)?\.ts$/.test(path),
  );

const Environment = Schema.Struct({
  CI: Schema.Literal("true"),
  GITHUB_ACTIONS: Schema.Literal("true"),
  GITHUB_EVENT_NAME: Schema.Literals(["pull_request", "merge_group"]),
  GITHUB_REF: Schema.String,
  GITHUB_EVENT_PATH: Schema.String,
  GITHUB_SHA: Request.fields.sha,
  GITHUB_RUN_ID: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  GITHUB_RUN_ATTEMPT: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  RUNNER_TEMP: Schema.String,
  PATH: Schema.String,
  HOME: Schema.String,
  FILES: Schema.String,
  PLANTS: Schema.String,
  LEG: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  FABRIKA_TEST_DEPTH: Schema.Literal("full"),
});

const Ordinary = Schema.Struct({
  success: Schema.Literal(true),
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      assertionResults: Schema.Array(Schema.Struct({ fullName: Schema.String, status: Schema.String })),
    }),
  ),
});

const Manifest = Schema.Struct({
  packageManager: Schema.String,
  engines: Schema.Struct({ node: Schema.String }),
});

const Installed = Schema.Struct({ version: Schema.String });

const Catalog = Schema.Struct({ catalog: Schema.Struct({ vitest: Schema.String }) });

const Versions = Schema.Struct({ node: Schema.String, pnpm: Schema.String, vitest: Schema.String });

const Event = Schema.Struct({
  pull_request: Schema.optionalKey(
    Schema.Struct({
      head: Schema.Struct({ sha: Request.fields.sha }),
      base: Schema.Struct({ sha: Request.fields.sha }),
    }),
  ),
  merge_group: Schema.optionalKey(Schema.Struct({ head_sha: Request.fields.sha, base_sha: Request.fields.sha })),
});

const fail = (reason: string) => ExerciseError.make({ reason });

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const automatic = Effect.fn("plant.related")(function* (input: unknown) {
  const environment = yield* Schema.decodeUnknownEffect(Environment)(input).pipe(
    Effect.mapError(() => fail("automatic_environment")),
  );

  const fs = yield* FileSystem.FileSystem;

  const path = yield* Path.Path;

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const digest = yield* Digest.Digest;

  const root = path.resolve(".");

  const directory = path.join(environment.RUNNER_TEMP, "plant-related");

  const assignment = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.Array(Request.fields.case))),
  )(environment.PLANTS).pipe(Effect.mapError(() => fail("automatic_owner_or_catalog")));

  const selected = assignment[environment.LEG] ?? [];

  const legs = Object.keys(assignment).toSorted((a, b) => Number(a) - Number(b));

  const assigned = legs.flatMap((leg) => assignment[leg] ?? []);

  const observations: Effect.Success<ReturnType<typeof execute>>[] = [];

  const started = DateTime.formatIso(yield* DateTime.now);

  let source: string | null = null;

  let base: string | null = null;

  let tree: string | null = null;

  let versions: typeof Versions.Type | null = null;

  const facts = {
    kind: "automatic-checklist-faults",
    origin,
    catalog,
    head: environment.GITHUB_SHA,
    ref: environment.GITHUB_REF,
    event: environment.GITHUB_EVENT_NAME,
    run: environment.GITHUB_RUN_ID,
    attempt: environment.GITHUB_RUN_ATTEMPT,
    started,
    assignment,
    leg: environment.LEG,
    selected,
  };

  const write = (state: string, reason: string | null) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });

      yield* fs.writeFileString(
        path.join(directory, "result.json"),
        JSON.stringify(
          {
            ...facts,
            source,
            base,
            tree,
            versions,
            sourceReason:
              environment.GITHUB_EVENT_NAME === "merge_group"
                ? "merge-group event does not identify an originating PR head"
                : null,
            state,
            reason,
            cases: observations,
          },
          null,
          2,
        ),
      );
    });

  const command = Effect.fn("plant.related.command")(
    function* (executable: string, args: readonly string[]) {
      const process = yield* spawner.spawn(
        ChildProcess.make(executable, args, {
          cwd: root,
          stdin: "ignore",
        }),
      );

      const [exit, output] = yield* Effect.all(
        [
          process.exitCode,
          process.stdout.pipe(Stream.decodeText(), Stream.mkString),
          process.stderr.pipe(Stream.runDrain),
        ],
        { concurrency: "unbounded" },
      );

      if (Number(exit) !== 0) {
        return yield* fail("automatic_metadata");
      }

      return output;
    },
    Effect.scoped,
    Effect.mapError(() => fail("automatic_metadata")),
  );

  const git = (args: readonly string[]) => command("git", args);

  return yield* Effect.gen(function* () {
    yield* write("incomplete", "attempt_unfinished");

    const correctRef =
      environment.GITHUB_EVENT_NAME === "pull_request"
        ? /^refs\/pull\/[1-9][0-9]*\/merge$/.test(environment.GITHUB_REF)
        : environment.GITHUB_REF.startsWith("refs/heads/gh-readonly-queue/");

    if (
      !correctRef ||
      (yield* git(["rev-parse", "HEAD"])).trim() !== environment.GITHUB_SHA ||
      (yield* git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])) !== ""
    ) {
      return yield* fail("automatic_checkout");
    }

    const event = yield* fs.readFileString(environment.GITHUB_EVENT_PATH).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Event))),
      Effect.mapError(() => fail("automatic_event")),
    );

    if (environment.GITHUB_EVENT_NAME === "pull_request" && event.pull_request !== undefined) {
      source = event.pull_request.head.sha;
      base = event.pull_request.base.sha;

      yield* git(["merge-base", "--is-ancestor", source, environment.GITHUB_SHA]);
    } else if (
      environment.GITHUB_EVENT_NAME === "merge_group" &&
      event.merge_group?.head_sha === environment.GITHUB_SHA
    ) {
      base = event.merge_group.base_sha;
    } else {
      return yield* fail("automatic_event");
    }

    yield* git(["merge-base", "--is-ancestor", base, environment.GITHUB_SHA]);
    tree = (yield* git(["rev-parse", "HEAD^{tree}"])).trim();

    yield* write("incomplete", "attempt_unfinished");

    yield* git(["merge-base", "--is-ancestor", origin, catalog]);

    yield* git(["merge-base", "--is-ancestor", catalog, environment.GITHUB_SHA]);

    if (
      keys.length !== 10 ||
      legs.length < 1 ||
      legs.length > 5 ||
      legs.some((leg) => !/^[1-9][0-9]*$/.test(leg)) ||
      selected.length === 0 ||
      assigned.length !== keys.length ||
      new Set(assigned).size !== keys.length ||
      JSON.stringify(assigned.toSorted()) !== JSON.stringify(keys.toSorted()) ||
      legs.some(
        (leg, offset) =>
          JSON.stringify(assignment[leg]) !== JSON.stringify(keys.filter((_, index) => index % legs.length === offset)),
      )
    ) {
      return yield* fail("automatic_owner_or_catalog");
    }

    const ordinary = yield* fs.readFileString(path.join(environment.RUNNER_TEMP, "related.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Ordinary))),
      Effect.mapError(() => fail("ordinary_full_suite")),
    );

    const files = environment.FILES.split(/\s+/).filter(Boolean);

    const suites = ordinary.testResults.filter((suite) => suite.name === path.join(root, fixture));

    const suite = suites[0];

    if (
      files.length === 0 ||
      files.some((file) => !ordinary.testResults.some((result) => result.name === path.join(root, file))) ||
      ordinary.testResults.some((result) => result.status === "failed") ||
      (files.includes(fixture) &&
        (suites.length !== 1 ||
          suite === undefined ||
          suite.status !== "passed" ||
          suite.assertionResults.length === 0 ||
          suite.assertionResults.some((test) => test.status !== "passed") ||
          keys.some((key) => !suite.assertionResults.some((test) => test.fullName === cases[key].title))))
    ) {
      return yield* fail("ordinary_full_suite");
    }

    const manifests = (files: string) =>
      files
        .split("\0")
        .filter(
          (file) =>
            file === "package.json" ||
            file.endsWith("/package.json") ||
            file === "pnpm-lock.yaml" ||
            file === "pnpm-workspace.yaml",
        )
        .toSorted();

    const previous = manifests(yield* git(["ls-tree", "-r", "--name-only", "-z", catalog]));

    const current = manifests(yield* git(["ls-tree", "-r", "--name-only", "-z", environment.GITHUB_SHA]));

    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      return yield* fail("automatic_versions");
    }

    for (const file of previous) {
      const pinned = new TextEncoder().encode(yield* git(["show", `${catalog}:${file}`]));

      if (!bytesEqual(pinned, yield* fs.readFile(path.join(root, file)))) {
        return yield* fail("automatic_versions");
      }
    }

    const manifest = yield* fs
      .readFileString(path.join(root, "package.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))));

    const workspace = Schema.decodeUnknownSync(Catalog)(
      parse(yield* fs.readFileString(path.join(root, "pnpm-workspace.yaml"))),
    );

    const installed = Schema.decodeUnknownSync(Installed)(vitest);

    const pnpm = (yield* command("pnpm", ["--version"])).trim();
    versions = Versions.make({ node: process.versions.node, pnpm, vitest: installed.version });

    yield* write("incomplete", "attempt_unfinished");

    if (
      versions.node !== manifest.engines.node ||
      manifest.packageManager !== `pnpm@${versions.pnpm}` ||
      workspace.catalog.vitest !== versions.vitest
    ) {
      return yield* fail("automatic_versions");
    }

    let pinned = 0;

    for (const key of keys) {
      const selected = cases[key];

      const target = path.join(root, selected.file);

      const original = yield* fs.readFile(target);

      const info = yield* fs.lstat(target);

      const catalogBytes = new TextEncoder().encode(yield* git(["show", `${catalog}:${selected.file}`]));

      if (info.type !== "File" || info.mode !== 0o100644 || !bytesEqual(original, catalogBytes)) {
        return yield* fail("automatic_catalog_image");
      }

      if ("hashes" in selected) {
        pinned++;

        const prepared = yield* prepare(key, original);

        const edited = yield* derive(key, prepared);

        const hashes = [original, prepared, edited];

        const expected = [selected.hashes.source, selected.hashes.prepared, selected.hashes.edited];

        if (selected.source !== catalog) {
          return yield* fail("automatic_catalog_image");
        }

        for (const [index, bytes] of hashes.entries()) {
          if ((yield* digest.digestHex(Digest.sha256, bytes)) !== expected[index]) {
            return yield* fail("automatic_catalog_image");
          }
        }
      }
    }

    if (pinned !== 9) {
      return yield* fail("automatic_catalog_image");
    }

    let complete = true;

    for (const key of selected) {
      const result = yield* execute(environment, Request.make({ case: key, sha: catalog }), {
        runner: root,
        source: root,
        runnerHead: environment.GITHUB_SHA,
        head: environment.GITHUB_SHA,
        install: false,
      });
      observations.push(result);

      yield* write("incomplete", "attempt_unfinished");

      if (!result.cleanup.restored) {
        return yield* fail("exercise_incomplete");
      }

      complete &&= accepted(key, result.model);
    }

    if (!complete) {
      return yield* fail("exercise_incomplete");
    }

    yield* write("recorded", null);

    return true;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        const error = Cause.findErrorOption(cause);

        const reason =
          Option.isSome(error) && Schema.is(ExerciseError)(error.value) ? error.value.reason : "automatic_setup_or_io";

        yield* write("incomplete", reason);

        return false;
      }),
    ),
  );
});

if (import.meta.main) {
  NodeRuntime.runMain(
    automatic(process.env).pipe(
      Effect.tap((complete) =>
        Effect.sync(() => {
          if (!complete) process.exitCode = 1;
        }),
      ),
      Effect.catchCause(() =>
        Effect.sync(() => {
          console.error("automatic checklist faults: incomplete");
          process.exitCode = 1;
        }),
      ),
      Effect.provide(NodeServices.layer),
      Effect.provide(Digest.layerWebCrypto),
    ),
  );
}
