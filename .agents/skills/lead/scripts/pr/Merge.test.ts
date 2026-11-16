// Today's lead tooling. The laws of `land.ts merge` and of the leak gate every merge path runs
// (field/notes/2026-11-15-admin-merge-ran-past-a-leak-grep-hit.json). Merge's laws run on the test
// layers and ask GitHub nothing. The gate's process laws run the real leakgrep.sh, on a word list in
// a temp folder, and a scripts folder with no leakgrep.sh in it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import * as ChecksTest from "../ci/ChecksTest.ts";
import * as Merge from "./Merge.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as PushesProcess from "./PushesProcess.ts";
import * as PushesTest from "./PushesTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";
const branch = "fabrikalfa/decision-1415";
const title = "Decision 0583: a room is one process";
const body = "What it decides.";

/** Which leak check refuses, by its method's name, or none. */
const Leak = Schema.Literals(["clean", "leakChange", "leakGrep", "leakText"]);
const hit = new LeakGrepRefused({ reason: "leakgrep.sh exited 1" });

/** The one leak check that refuses, with the error it refuses with. */
const leaking = (leak: typeof Leak.Type): PushesTest.Failing =>
  leak === "clean"
    ? {}
    : leak === "leakChange"
      ? { leakChange: hit }
      : leak === "leakGrep"
        ? { leakGrep: hit }
        : { leakText: hit };

const Files = Schema.Literals(["docs", "code", "none"]);

const FILES = {
  docs: [".decisions/0583-a-room.md", "field/notes/2026-11-15-x.json", "docs/plan/README.md"],
  // One file that is not docs is enough, even in a docs folder.
  code: [".decisions/0583-a-room.md", "docs/tutorials/one/package.json"],
  none: [],
} as const;

type World = {
  readonly leak?: typeof Leak.Type;
  readonly files?: typeof Files.Type;
  readonly required?: "success" | "failure";
  readonly title?: string;
};

const memory = (w: World = {}) => {
  const github = PullRequestsTest.world([{ number: 1415, head: branch, oid, state: "OPEN", draft: false }]);
  github.more.set(1415, { title: w.title ?? title, body });
  github.files.set(1415, FILES[w.files ?? "docs"]);
  const remote = PushesTest.remote();
  const job = { id: 1, status: "completed", conclusion: w.required ?? "success" };
  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github),
    PushesTest.layer(remote, leaking(w.leak ?? "clean")),
    ChecksTest.layer([Option.some(job)], ""),
  );
  return { github, layer };
};

const merge = (m: ReturnType<typeof memory>, route: Merge.Route) =>
  Merge.merge({ dir: ".", pr: 1415, route }).pipe(Effect.provide(m.layer));

/** One merge, and the leak checks it asked for, read inside the layer that recorded them. */
const merged = (m: ReturnType<typeof memory>, route: Merge.Route) =>
  Effect.gen(function* () {
    const answer = yield* Effect.result(Merge.merge({ dir: ".", pr: 1415, route }));
    return { answer, leaks: yield* Recorder.calls(Pushes) };
  }).pipe(Effect.provide(m.layer));

const queue = Merge.Route.cases.queue.make({});
const admin = (sev0: ReadonlyArray<string> = []) => Merge.Route.cases.admin.make({ sev0 });

/** The three leak checks, in order, as the gate runs them on pull request 1415. */
const gate = [
  { method: "leakChange", args: [".", oid] },
  { method: "leakGrep", args: [".", oid] },
  { method: "leakText", args: [".", `${title}\n\n${body}\n`] },
];

describe("merge: the lead's one way to merge by hand runs the leak gate first", () => {
  // Plants: merge before the gate, or past a refusal from it; skip the commit or the word grep;
  // admin-merge a pull request with one file that is not docs; admin-merge a sev0 fix on a red head.
  it.effect.prop(
    "property: GitHub's merge is asked once, pinned to the head, only when all three leak checks passed, and --admin only for a docs-only pull request or a branch an open sev0 allows whose ci-required is green",
    {
      route: Schema.Literals(["queue", "admin"]),
      leak: Leak,
      files: Files,
      sev0: Schema.Boolean,
      required: Schema.Literals(["success", "failure"]),
    },
    ({ route, leak, files, sev0, required }) =>
      Effect.gen(function* () {
        const m = memory({ leak, files, required });
        const { answer, leaks } = yield* merged(m, route === "queue" ? queue : admin(sev0 ? [branch] : []));
        const clean = leak === "clean";
        const docs = files === "docs";
        const merges =
          route === "queue" ? clean && required === "success" : clean && (docs || (sev0 && required === "success"));
        const asked =
          route === "queue"
            ? PullRequestsTest.Call.cases.enqueue.make({ number: 1415, oid })
            : PullRequestsTest.Call.cases.admin.make({ number: 1415, oid });
        expect(m.github.calls).toEqual(merges ? [asked] : []);
        expect(answer._tag).toBe(merges ? "Success" : "Failure");

        if (merges) {
          expect(leaks).toEqual(gate);
        }

        // An admin merge GitHub's rules would not allow refuses before any grep runs.
        if (route === "admin" && !docs && !sev0) {
          expect(leaks).toEqual([]);
        }
      }),
  );

  // Plant: read only the change, as the 2026-11-15 shell line read only the description, or the reverse.
  it.effect(
    "scenario: a leak word in the description refuses --admin on a docs-only pull request, and nothing merges",
    () =>
      Effect.gen(function* () {
        const m = memory({ leak: "leakText" });
        const { answer, leaks } = yield* merged(m, admin());
        expect(answer._tag === "Failure" && answer.failure).toBeInstanceOf(LeakGrepRefused);
        expect(leaks).toEqual(gate);
        expect(m.github.calls).toEqual([]);
      }),
  );

  it.effect("scenario: a leak word in a commit refuses, with or without --admin, and nothing merges", () =>
    Effect.gen(function* () {
      for (const route of [queue, admin()]) {
        const m = memory({ leak: "leakGrep" });
        const { answer, leaks } = yield* merged(m, route);
        expect(answer._tag === "Failure" && answer.failure).toBeInstanceOf(LeakGrepRefused);
        expect(leaks).toEqual(gate.slice(0, 2));
        expect(m.github.calls).toEqual([]);
      }
    }),
  );

  it.effect("scenario: a clean docs-only pull request is admin-merged at its head, and the line says why", () =>
    Effect.gen(function* () {
      const m = memory();
      const done = yield* merge(m, admin());
      expect(m.github.calls).toEqual([PullRequestsTest.Call.cases.admin.make({ number: 1415, oid })]);
      expect(Merge.line(done)).toBe(
        `pr 1415: admin-merged at ${oid}, docs only (0183); read the push run on main next`,
      );
    }),
  );

  it.effect(
    "vector: --admin on a pull request with a file that is not docs names it and refuses; one that changes no files refuses; a `Plan:` title refuses",
    () =>
      Effect.gen(function* () {
        const code = yield* Effect.flip(merge(memory({ files: "code" }), admin()));
        expect(code).toBeInstanceOf(Merge.NotMerged);
        expect(code).toMatchObject({
          reason: `pr 1415: not docs only (0183), and no open sev0 allows ${branch} (0532); --admin refused: docs/tutorials/one/package.json`,
        });
        const none = yield* Effect.flip(merge(memory({ files: "none" }), admin()));
        expect(none).toMatchObject({ reason: "pr 1415: it changes no files, so it is not docs only; refused" });
        const plan = yield* Effect.flip(merge(memory({ title: "Plan: a room" }), admin()));
        expect(plan.reason).toContain("its title starts `Plan:`");
      }),
  );

  it("vector: the admin merge call is the queue's pinned squash with --admin and nothing else", () => {
    expect(PullRequestsGh.adminArgs("o/r", 1415, oid)).toEqual([
      "pr",
      "merge",
      "1415",
      "-R",
      "o/r",
      "--squash",
      "--match-head-commit",
      oid,
      "--admin",
    ]);
  });
});

describe("the leak gate's process: the real leakgrep.sh, whose exit code decides", () => {
  const scripts = import.meta.dirname.replace(/\/pr$/, "");
  const planted = "plantedleakgate1415";
  let dir = "";

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const words = () => {
    dir = mkdtempSync(join(tmpdir(), "leakgate-"));
    writeFileSync(join(dir, "words"), `${planted}\n`);
    vi.stubEnv("FABRIKA_LEAK_WORDS", join(dir, "words"));
  };

  const withPushes = <A, E>(use: (p: Pushes["Service"]) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      return yield* use(yield* Pushes);
    });

  const pushes = (at: string) => Effect.provide(Layer.provide(PushesProcess.layer(at), NodeServices.layer));

  // Plant: read leakgrep.sh's output or ignore its exit code, as the 2026-11-15 shell line did.
  it.effect(
    "scenario: a description with a leak word makes leakgrep.sh exit non-zero, and the words check refuses",
    () =>
      Effect.gen(function* () {
        words();
        const grep = (text: string) => Effect.result(withPushes((p) => p.leakText(import.meta.dirname, text)));
        const hit = yield* grep(`${title}\n\nIt names ${planted} once.\n`).pipe(pushes(scripts));
        expect(hit._tag === "Failure" && hit.failure.reason).toMatch(/^leakgrep\.sh --text exited [1-9]/);
        // The reason names only the kind, never the word.
        expect(hit._tag === "Failure" && hit.failure.reason.includes(planted)).toBe(false);
        const clean = yield* grep(`${title}\n\n${body}\n`).pipe(pushes(scripts));
        expect(clean._tag).toBe("Success");
      }),
  );

  // Plant: count a grep that could not start, or exited 127, as a pass.
  it.effect("scenario: a leak grep that cannot run refuses the words and the commits, never passes them", () =>
    Effect.gen(function* () {
      words();
      const missing = join(dir, "no-scripts-here");
      const text = yield* Effect.result(withPushes((p) => p.leakText(import.meta.dirname, `${title}\n`))).pipe(
        pushes(missing),
      );
      const commits = yield* Effect.result(withPushes((p) => p.leakGrep(import.meta.dirname, "HEAD"))).pipe(
        pushes(missing),
      );

      for (const ran of [text, commits]) {
        expect(ran._tag === "Failure" && ran.failure._tag).toBe("LeakGrepRefused");
      }
    }),
  );
});
