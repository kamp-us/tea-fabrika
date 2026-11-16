// P39 slice 4b, next/: the real `Commands` layer's merge-line laws C1, C2 and C3, over a fake
// `ChildProcessSpawner.make` (`Spawner.test-support.ts`) and the in-memory file system (`MemoryFiles.test-support.ts`). No real
// process starts here; C4 and C5 run the real spawner on the schedule.
//
// What these laws hold `node/client/CommandsNode.ts` to, from the approved plan
// (docs/plan/quests/p39-s5-PLAN.md, "The command"):
// - `CommandsNode.layer` supplies `Commands` from Effect's `ChildProcessSpawner`, `FileSystem`, `Path`
//   and the `PATH` the config provider gives.
// - `execute(git_version)` spawns `git` with argv `["--version"]`, `extendEnv: false` and env `{ PATH }`
//   only, in a scope of its own. stdout and stderr together may print 4096 bytes; past that the
//   child's scope closes and the answer is `failed output_limit`. A spawn that fails is `failed
//   spawn_failed`. A child that exits is `exited { code, version }`, `version` its stdout as UTF-8
//   with one trailing "\n" dropped, or "" when stdout is not UTF-8. Never an error or a defect.
// - `has` is `["git"]` exactly when a `PATH` folder holds a file `git` with an execute bit.
//
// The oracle keeps its own count of spawns and closes and computes each answer from the generated
// child alone; it never calls the product to decide what is right.
//
// Plants, each run once and undone (recorded in the tests step's field row): C1, count only stdout
// toward the cap. C2, spawn with `extendEnv: true`. C3, report `git` when the file exists without
// an execute bit.
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Layer, Path } from "effect";
import * as fc from "fast-check";
import { Commands } from "../../client/Commands.ts";
import { Command, type Result } from "../../tasks/Task.ts";
import { property } from "../../Testing.test-support.ts";
import * as CommandsNode from "./CommandsNode.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";
import { type Child, fresh, gitVectors, type Seen, spawner } from "./Spawner.test-support.ts";

/** The plan's cap for `git_version`: stdout and stderr together, in bytes. */
const CAP = 4096;
const GIT_VERSION = Command.cases.git_version.make({});

/** The disk C1 and C2 run on: one executable `git` on the `PATH` they give. */
const withGit = () => {
  const d = MemoryFiles.disk(["/usr/bin"]);
  MemoryFiles.put(d, "/usr/bin/git", new Uint8Array([0x7f, 0x45, 0x4c, 0x46]), 0o755);
  return d;
};

const layers = (child: Child, seen: Seen, env: Record<string, string>, d: MemoryFiles.Disk) =>
  CommandsNode.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        spawner(child, seen),
        MemoryFiles.layer(d),
        Path.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      ),
    ),
  );

/** The oracle's answer for a child: from its bytes alone. */
const expected = (child: Child): Result => {
  if (child.spawn === "fails") {
    return { _tag: "failed", reason: "spawn_failed" };
  }

  const total = child.chunks.reduce((n, c) => n + c.bytes.length, 0);

  if (total > CAP) {
    return { _tag: "failed", reason: "output_limit" };
  }

  const out = new Uint8Array(child.chunks.filter((c) => c.to === "out").flatMap((c) => [...c.bytes]));
  const decoded = new TextDecoder().decode(out);
  // Bytes are UTF-8 exactly when decoding and encoding again gives them back: a byte that is not
  // becomes U+FFFD, three other bytes. stdout that is not UTF-8 answers an empty version.
  const text =
    encoder.encode(decoded).every((b, i) => b === out[i]) && encoder.encode(decoded).length === out.length
      ? decoded
      : "";

  return { _tag: "exited", code: child.code, version: text.endsWith("\n") ? text.slice(0, -1) : text };
};

const encoder = new TextEncoder();

/** Bytes cut at generated points into chunks, each at least one byte. */
const cut = (bytes: Uint8Array, at: ReadonlyArray<number>): Array<Uint8Array> => {
  const points = [...new Set(at.map((n) => (bytes.length === 0 ? 0 : n % bytes.length)))].filter((n) => n > 0);
  points.sort((a, b) => a - b);
  const chunks: Array<Uint8Array> = [];
  let from = 0;

  for (const p of [...points, bytes.length]) {
    if (p > from) {
      chunks.push(bytes.slice(from, p));
      from = p;
    }
  }

  return chunks;
};

/** Two chunk lists merged in a generated order that keeps each list's own order. */
const merge = <A>(a: ReadonlyArray<A>, b: ReadonlyArray<A>, picks: ReadonlyArray<boolean>): Array<A> => {
  const out: Array<A> = [];
  let i = 0,
    j = 0,
    k = 0;

  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && (picks[k++ % Math.max(picks.length, 1)] ?? true));
    // SAFETY: the loop guard keeps i below a.length when it takes from a, and j below b.length otherwise.
    out.push(takeA ? (a[i++] as A) : (b[j++] as A));
  }

  return out;
};

/**
 * C1's children: stdout as text (any code points, so multi-byte UTF-8 splits across chunks) with a
 * generated ending, or text with one byte that is never UTF-8; stderr sized so the total falls just
 * under, on, just over, or far from the cap; both cut into chunks and interleaved; a generated exit
 * code; a spawn that fails one time in eight.
 */
const ChildArb: fc.Arbitrary<Child> = fc
  .record({
    spawnFails: fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
    text: fc.string({ unit: "binary", maxLength: 120 }),
    repeat: fc.integer({ min: 1, max: 60 }),
    ending: fc.constantFrom("", "\n", "\n\n", "\r\n", " \n"),
    broken: fc.option(fc.nat(), { freq: 5 }),
    total: fc.oneof(
      fc.constantFrom(CAP - 1, CAP, CAP + 1),
      fc.integer({ min: 0, max: 200 }),
      fc.integer({ min: CAP - 64, max: CAP + 64 }),
      fc.integer({ min: CAP + 1, max: CAP * 3 }),
    ),
    outCuts: fc.array(fc.nat(), { maxLength: 8 }),
    errCuts: fc.array(fc.nat(), { maxLength: 8 }),
    order: fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
    code: fc.integer({ min: 0, max: 255 }),
    endless: fc.boolean(),
    errByte: fc.integer({ min: 0, max: 255 }),
  })
  .map((g): Child => {
    // No byte order mark: the plan does not say whether a leading one stays in `version`.
    let out = encoder.encode(g.text.replaceAll("﻿", "").repeat(g.repeat) + g.ending);

    if (g.broken !== null) {
      // 0xFF is never a byte of UTF-8, wherever it stands.
      const copy = new Uint8Array(out.length + 1);
      const at = out.length === 0 ? 0 : g.broken % out.length;
      copy.set(out.subarray(0, at), 0);
      copy[at] = 0xff;
      copy.set(out.subarray(at), at + 1);
      out = copy;
    }

    const err = new Uint8Array(Math.max(0, g.total - out.length)).fill(g.errByte);
    const chunks = merge<Child["chunks"][number]>(
      cut(out, g.outCuts).map((bytes) => ({ to: "out", bytes })),
      cut(err, g.errCuts).map((bytes) => ({ to: "err", bytes })),
      g.order,
    );
    const total = out.length + err.length;
    return {
      spawn: g.spawnFails ? "fails" : "ok",
      chunks,
      code: g.code,
      endless: g.endless && total > CAP,
    };
  });

const execute = (child: Child, seen: Seen, env: Record<string, string>, d: MemoryFiles.Disk) =>
  Commands.use((commands) => commands.execute(GIT_VERSION)).pipe(
    Effect.provide(layers(child, seen, env, d)),
    // A child that hangs past its cap would hold the law forever: bounded, so it fails instead.
    Effect.timeoutOption("10 seconds"),
    Effect.exit,
  );

/** A word that may name or fill an environment variable. */
const Word = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/);

describe("P39 slice 4b: the real command layer", () => {
  it.live(
    "C1: execute answers exited { code, version } for a child that exits, failed spawn_failed when the spawn fails, failed output_limit with the child's scope closed once stdout and stderr together pass the cap, and never an error or a defect",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          ChildArb,
          (child) =>
            Effect.gen(function* () {
              const seen = fresh();
              const exit = yield* execute(child, seen, { PATH: "/usr/bin" }, withGit());
              expect(Exit.isSuccess(exit), `C1: execute never fails or dies: ${String(exit)}`).toBe(true);

              if (!Exit.isSuccess(exit)) {
                return;
              }

              expect(exit.value._tag, "C1: a child past its cap is stopped, never waited on forever").toBe("Some");

              if (exit.value._tag !== "Some") {
                return;
              }

              const answer = exit.value.value;
              const want = expected(child);
              expect(answer, "C1: the answer is the oracle's, from the child's bytes alone").toEqual(want);
              expect(seen.commands.length, "C1: one execute spawns one child").toBe(1);
              expect(seen.closes, "C1: every child that started has its scope closed by the time execute answers").toBe(
                seen.spawns,
              );
              reached.add(
                want._tag === "failed"
                  ? want.reason
                  : want._tag === "exited" && want.version === ""
                    ? "exited:empty"
                    : "exited",
              );

              if (child.endless) {
                reached.add("endless");
              }
            }),
          { numRuns: 100 },
        );
        // The walk is no law unless it reached each answer at least once.
        expect([...reached]).toEqual(
          expect.arrayContaining(["spawn_failed", "output_limit", "exited", "exited:empty", "endless"]),
        );
      }),
    120_000,
  );

  it.live("C1 vector: real git's own stdout, saved by C4's run, answers exited with its line less the newline", () =>
    Effect.gen(function* () {
      expect(gitVectors.length).toBeGreaterThan(0);

      for (const vector of gitVectors) {
        const seen = fresh();
        const child: Child = {
          spawn: "ok",
          chunks: [{ to: "out", bytes: encoder.encode(vector.stdout) }],
          code: 0,
          endless: false,
        };
        const exit = yield* execute(child, seen, { PATH: "/usr/bin" }, withGit());
        const answer = Exit.isSuccess(exit) && exit.value._tag === "Some" ? exit.value.value : null;
        expect(answer).toEqual({ _tag: "exited", code: 0, version: vector.version });
      }
    }),
  );

  it.live(
    "C2: [secrets] the spawned command is git with argv [--version], extendEnv false and env holding only PATH; a planted secret in the hands' environment never reaches the child",
    () =>
      property(
        fc.record({
          env: fc.dictionary(Word, fc.string({ maxLength: 40 }), { maxKeys: 12 }),
          name: Word.filter((w) => w !== "PATH"),
          secret: fc.stringMatching(/^[A-Za-z0-9+/=_-]{12,40}$/),
          path: fc.array(fc.stringMatching(/^\/[a-z]{1,8}(\/[a-z]{1,8})?$/), { minLength: 1, maxLength: 4 }),
        }),
        ({ env, name, secret, path }) =>
          Effect.gen(function* () {
            const planted = `planted-${secret}`;
            const PATH = path.join(":");
            const seen = fresh();
            const child: Child = { spawn: "ok", chunks: [], code: 0, endless: false };
            yield* execute(child, seen, { ...env, [name]: planted, PATH }, withGit());
            expect(seen.commands.length, "C2: one execute spawns one command").toBe(1);
            const command = seen.commands[0];

            if (command === undefined) {
              return;
            }

            expect(command.command, "C2: the executable is git, found on PATH").toBe("git");
            expect(command.args.map(String), "C2: the argv is exactly --version").toEqual(["--version"]);
            expect(command.options.extendEnv, "C2: the child is not given the hands' environment").toBe(false);
            const childEnv = command.options.env ?? {};
            expect(Object.keys(childEnv), "C2: the child's environment holds PATH and nothing else").toEqual(["PATH"]);
            expect(String(childEnv["PATH"]), "C2: PATH is the hands' own PATH").toBe(PATH);
            // Every named output of the spawn: the executable, the argv and every option, in each form a
            // value could be written.
            const text = JSON.stringify(
              { c: command.command, a: command.args.map(String), o: command.options },
              (_k, v) => (typeof v === "object" && v !== null && "value" in v ? String(v.value) : v),
            );
            const forms = [
              planted,
              encodeURIComponent(planted),
              Buffer.from(planted).toString("base64"),
              Buffer.from(planted).toString("base64url"),
            ];

            for (const form of forms) {
              expect(text.includes(form), "C2: [secrets] the planted value reaches the child in no form").toBe(false);
            }
          }),
        { numRuns: 100 },
      ),
    120_000,
  );

  it.live(
    "C3: has is [git] exactly when a PATH folder holds a file named git with an execute bit, and [] otherwise",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          fc.array(
            fc.record({
              kind: fc.constantFrom("none", "folder", "file", "file"),
              // Any permission bits: an execute bit is any of owner, group or other's.
              mode: fc.integer({ min: 0, max: 0o777 }),
            }),
            // At least one folder: an empty PATH is no PATH, and the layer reads PATH as a required value.
            { minLength: 1, maxLength: 6 },
          ),
          (folders) =>
            Effect.gen(function* () {
              const names = folders.map((_, i) => `/opt/p${i}/bin`);
              const d = MemoryFiles.disk(names);
              folders.forEach((f, i) => {
                const git = `${names[i]}/git`;

                if (f.kind === "file") {
                  MemoryFiles.put(d, git, new Uint8Array([0x23, 0x21]), f.mode);
                } else if (f.kind === "folder") {
                  d.entries.set(git, { type: "Directory", mode: 0o755, mtime: new Date(0) });
                }
              });
              const runnable = folders.some((f) => f.kind === "file" && (f.mode & 0o111) !== 0);
              const has = yield* Commands.use((commands) => Effect.succeed(commands.has)).pipe(
                Effect.provide(
                  layers({ spawn: "ok", chunks: [], code: 0, endless: false }, fresh(), { PATH: names.join(":") }, d),
                ),
              );
              expect(
                has,
                "C3: has reads an executable git on PATH, never a folder or a file without an execute bit",
              ).toEqual(runnable ? ["git"] : []);
              reached.add(runnable ? "git" : "none");

              if (!runnable && folders.some((f) => f.kind === "file")) {
                reached.add("file-without-x");
              }

              if (!runnable && folders.some((f) => f.kind === "folder")) {
                reached.add("folder");
              }
            }),
          { numRuns: 100 },
        );
        expect([...reached]).toEqual(expect.arrayContaining(["git", "none", "file-without-x", "folder"]));
      }),
    120_000,
  );
});
