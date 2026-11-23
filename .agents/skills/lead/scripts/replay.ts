// replay.ts: run a changed check against the repo's real pull requests before it lands (ticket 1302). Today's
// lead tooling, run on our own laptop; it is not product.
//
// Three checks landed in one week that refused real, correct pull requests the first time they ran (the
// slow-test reporter turned main red, the survivor gate refused its own cap, the signed-commit check refused
// every fix round). Each passed its own tests and its review, because both use made-up cases. This runs the
// changed check on the real ones.
//
//   nice -n 15 node .agents/skills/lead/scripts/replay.ts <pr> [--merged <n>]
//   nice -n 15 node .agents/skills/lead/scripts/replay.ts --head <ref> [--base <ref>] [--merged <n>]
//
// `<pr>` names the pull request that changes a check. `--head` names a commit instead, for a change that
// has no pull request yet or one that merged already; `--base` is where the change starts (default
// origin/main). The checks the change touches come from `git diff <base>...<head>`:
//
//   land check     land.ts, pr/*.ts, leakgrep.sh      replayed for real: git and GitHub are read as they are
//   the rest       stepcommit.sh, survivors.ts, the oxlint plugins, the vitest reporters, the CI gate
//                  scripts                            listed as "not replayed", each with its reason
//
// A change that touches none of them prints that and exits 0.
//
// What a replay does, one pull request at a time, under `nice -n 15`, with no CI run and no test run:
//   1. makes two scratch worktrees, the change's head and the base (`<base>`, origin/main unless told),
//      links this repo's node_modules into each, and removes both when it ends;
//   2. takes the last `--merged` pull requests that landed on main (default 20, read from main's own
//      history) and every open one, the pull request being replayed excepted;
//   3. runs the head's version of the check on each; only a pull request it refuses gets the base's version
//      too, so a refusal main also gives is told from a new one.
// The land check runs two ways, since `land.ts check` stops at its first refusal and a refusal that hides
// another would hide the very one under test: `land.ts check <pr>` as the lead runs it, and the version's own
// `unsignedCommits` on the pull request's head, run by a child node in that version's worktree.
//
// Output: one line per refusal, `refused: pr <n> [<check>] new|also on main: <reason>`, then one line per
// check or pull request it could not replay, `not replayed: ...`, then a count. Exit 1 when any refusal is
// new, which the base does not give; else 0, whatever the list holds. Exit 1 too when it cannot read what
// it needs (the head, the pull request list), after one line that says so.
//
// What it cannot see: a refusal that depends on something a pull request had when it landed (a ticket that
// was open then, a note signed on another machine), since it reads the repo as it stands today; every refusal
// of a merged pull request is read with that in mind. And what the "not replayed" lines name.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { run } from "./pr/command.ts";
import { repoFromUrl } from "./pr/PullRequestsGh.ts";

// ---------------------------------------------------------------- the checks a change can touch

/** How a kind of check is replayed: `land` is a real replay; `none` gives the reason it is not one. */
export const Replay = Schema.TaggedUnion({ land: {}, none: { reason: Schema.String } });

export type Replay = typeof Replay.Type;

/** One kind of check, the paths that make it, and how it is replayed. */
export type Kind = {
  readonly id: string;
  readonly label: string;
  readonly matches: (path: string) => boolean;
  readonly replay: Replay;
};

const isLaw = (path: string) => /\.(test|test-support|integration\.test)\.[cm]?[jt]s$/.test(path);

const LEAD = ".agents/skills/lead/scripts/";

const notReplayed = (reason: string): Replay => Replay.cases.none.make({ reason });

/** The kinds, in the order a path is tried: a path belongs to the first kind that matches it. */
export const KINDS: ReadonlyArray<Kind> = [
  {
    id: "land",
    label: "land checks",
    matches: (p) =>
      !isLaw(p) &&
      (p === `${LEAD}land.ts` ||
        p === `${LEAD}leakgrep.sh` ||
        (p.startsWith(`${LEAD}pr/`) && p.endsWith(".ts") && !p.endsWith("Test.ts"))),
    replay: Replay.cases.land.make({}),
  },
  {
    id: "stepcommit",
    label: "stepcommit.sh",
    matches: (p) =>
      p === ".agents/skills/step-commit/scripts/stepcommit.sh" || p.endsWith("/step-commit/scripts/exam.py"),
    replay: notReplayed(
      "it checks the files a step is about to commit in a working tree; no saved pull request data holds that, and replaying it means redoing each pull request's commits",
    ),
  },
  {
    id: "survivors",
    label: "the survivor gate",
    matches: (p) =>
      !isLaw(p) &&
      (/^\.agents\/skills\/mutation\/scripts\/(survivors|scope|sample)\.ts$/.test(p) || p === `${LEAD}mutbox.ts`),
    replay: notReplayed(
      "it runs Stryker in a Docker box on one change and CI saves no survivor result, so replaying it is a mutation run per pull request",
    ),
  },
  {
    id: "oxlint",
    label: "the oxlint plugins",
    matches: (p) =>
      !isLaw(p) &&
      (p === ".oxlintrc.json" ||
        (/^oxlint-plugins\/[^/]+\.(ts|mjs)$/.test(p) && !p.endsWith("-support.ts")) ||
        /^oxlint-plugins\/css\//.test(p)),
    replay: notReplayed(
      "a lint run needs each pull request's whole tree checked out and linted, and CI saves no lint result to read instead",
    ),
  },
  {
    id: "reporters",
    label: "the vitest reporters",
    matches: (p) => !isLaw(p) && (/^\.github\/ci\/[a-z0-9-]*reporter\.ts$/.test(p) || p === "vitest.hostrun.ts"),
    replay: notReplayed(
      "a reporter reads a live run, each test with the time limit it ran under; the vitest JSON that CI saves holds no such limit, and replaying needs a test run",
    ),
  },
  {
    id: "gates",
    label: "the CI gate scripts",
    matches: (p) =>
      !isLaw(p) && (/^\.github\/ci\/[^/]+\.(mjs|ts)$/.test(p) || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)),
    replay: notReplayed(
      "a gate reads one workflow run's event and job results; replaying it starts a CI run, which this never does",
    ),
  },
];

/** The kind a path belongs to: the first that matches it. */
const owner = (path: string): Kind | undefined => KINDS.find((kind) => kind.matches(path));

/** The kinds of check a change's paths touch, each once, in `KINDS` order. */
export const changedChecks = (paths: ReadonlyArray<string>): ReadonlyArray<Kind> =>
  KINDS.filter((kind) => paths.some((p) => owner(p) === kind));

// ---------------------------------------------------------------- refusals and the verdict

/** One refusal: the pull request, the check that gave it, and why. */
export type Refusal = { readonly pr: number; readonly check: string; readonly reason: string };

/** What one replay of one version on one pull request gave: its refusals, and what it could not read. */
export type Outcome = { readonly refusals: ReadonlyArray<Refusal>; readonly unreadable: ReadonlyArray<string> };

/** A pull request to replay against. */
export type Target = { readonly number: number; readonly oid: string; readonly state: "OPEN" | "MERGED" };

type Version = "head" | "base";

/** Runs one version of one replayed kind on one pull request. */
export type Probe = (kind: Kind, version: Version, target: Target) => Effect.Effect<Outcome>;

/** A refusal and whether the base's version of the check gives it too. */
type Found = Refusal & { readonly fresh: boolean };

const identity = (r: Refusal) => `${r.pr}\u0000${r.check}\u0000${r.reason}`;

/** The head's refusals, each marked new unless the base gives that same refusal. */
const compare = (head: ReadonlyArray<Refusal>, base: ReadonlyArray<Refusal>): ReadonlyArray<Found> => {
  const given = new Set(base.map(identity));

  return head.map((r) => ({ ...r, fresh: !given.has(identity(r)) }));
};

/** What every replay of every target found. */
type Replayed = { readonly found: ReadonlyArray<Found>; readonly notReplayed: ReadonlyArray<string> };

/**
 * The head's version of each replayed kind on each target, one at a time. Only a target the head refuses
 * gets the base's version too. A kind with no replay is listed with its reason and never run; a target a
 * kind could not be read on is listed with that reason.
 */
export const replayAll = Effect.fn("replay.replayAll")(function* (a: {
  readonly kinds: ReadonlyArray<Kind>;
  readonly targets: ReadonlyArray<Target>;
  readonly probe: Probe;
}) {
  const found: Array<Found> = [];
  const gaps: Array<string> = [];

  for (const kind of a.kinds) {
    if (Replay.guards.none(kind.replay)) {
      gaps.push(`${kind.label}: ${kind.replay.reason}`);
      continue;
    }

    for (const target of a.targets) {
      const head = yield* a.probe(kind, "head", target);
      gaps.push(...head.unreadable.map((cause) => `${kind.label}, pr ${target.number}: ${cause}`));

      if (head.refusals.length > 0) {
        const base = yield* a.probe(kind, "base", target);
        gaps.push(...base.unreadable.map((cause) => `${kind.label} on the base, pr ${target.number}: ${cause}`));
        found.push(...compare(head.refusals, base.refusals));
      }
    }
  }

  return { found, notReplayed: gaps } satisfies Replayed;
});

const oneLine = (text: string, most = 400) => {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > most ? `${flat.slice(0, most)}...` : flat;
};

/** The lines to print and the exit code: 1 only when a refusal is new. */
export const report = (a: Replayed & { readonly targets: number }): { lines: ReadonlyArray<string>; code: 0 | 1 } => {
  const fresh = a.found.filter((f) => f.fresh).length;

  return {
    lines: [
      ...a.found.map(
        (f) => `refused: pr ${f.pr} [${f.check}] ${f.fresh ? "new" : "also on main"}: ${oneLine(f.reason)}`,
      ),
      ...a.notReplayed.map((reason) => `not replayed: ${oneLine(reason)}`),
      `replay: ${fresh} new refusal(s), ${a.found.length - fresh} also on main, over ${a.targets} pull request(s)`,
    ],
    code: fresh > 0 ? 1 : 0,
  };
};

/** The line for a change that touches no check. */
const nothingChanged = "replay: the change touches no check replay knows; nothing to replay";

// ---------------------------------------------------------------- the land check, for real

const REFUSED = /^land: refused at the (\w+) check: (.*)$/;

/** Refused at these is the run's own trouble (a fetch, the env), not a verdict on the pull request. */
const TROUBLE = new Set(["env", "check", "fetch"]);

/**
 * What `land.ts check <pr>` said, from its exit code and stderr: nothing on exit 0, a refusal when it
 * names one of its own checks, and "unreadable" when it fails any other way.
 */
export const readCheck = (pr: number, code: number, stderr: string): Outcome => {
  if (code === 0) {
    return { refusals: [], unreadable: [] };
  }

  const last = stderr
    .trimEnd()
    .split("\n")
    .findLast((line) => line.startsWith("land: refused at"));

  const named = last === undefined ? null : REFUSED.exec(last);

  if (named === null) {
    return { refusals: [], unreadable: [`land.ts check exited ${code} with no refusal line: ${oneLine(stderr, 160)}`] };
  }

  const [, check = "", reason = ""] = named;

  return TROUBLE.has(check)
    ? { refusals: [], unreadable: [`land.ts check could not run: ${reason}`] }
    : // The signed-commit refusal comes from the head's own unsignedCommits, run apart, so this one is its copy.
      reason.includes("are not signed")
      ? { refusals: [], unreadable: [] }
      : { refusals: [{ pr, check: `land check: ${check}`, reason }], unreadable: [] };
};

/** The signed-commit refusal for the commits that carry no signature, or none when there are none. */
export const signedRefusal = (pr: number, unsigned: ReadonlyArray<string>): ReadonlyArray<Refusal> =>
  unsigned.length === 0
    ? []
    : [
        {
          pr,
          check: "land check: signed commits",
          reason: `${unsigned.length} commit(s) since main are not signed: ${unsigned.join("; ")}`,
        },
      ];

// ---------------------------------------------------------------- the world

class ReplayFailed extends Schema.TaggedError<ReplayFailed, { readonly brand: unique symbol }>()("ReplayFailed", {
  reason: Schema.String,
}) {}

const failed = (reason: string) => () => ReplayFailed.make({ reason });

/** One git or gh command at low priority, in `cwd`, that must succeed. */
const must = Effect.fnUntraced(function* (task: string, cwd: string, cmd: string, args: ReadonlyArray<string>) {
  const ran = yield* run("nice", ["-n", "15", cmd, ...args], cwd).pipe(
    Effect.mapError(failed(`${cmd} could not start`)),
  );

  if (ran.code !== 0) {
    return yield* ReplayFailed.make({ reason: `${task}: ${oneLine(`${ran.out} ${ran.err}`, 200)}` });
  }

  return ran.out.trim();
});

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

const View = Schema.fromJsonString(
  Schema.Struct({ headRefOid: Sha, state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]) }),
);

const Listed = Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Int, headRefOid: Sha })));

/** The pull request numbers in main's first-parent history, newest first: a squash merge ends its subject in `(#<n>)`. */
export const mergedNumbers = (subjects: ReadonlyArray<string>, most: number): ReadonlyArray<number> => {
  const seen = new Set<number>();

  for (const subject of subjects) {
    const n = /\(#(\d+)\)\s*$/.exec(subject)?.[1];

    if (n !== undefined) {
      seen.add(Number(n));
    }
  }

  return [...seen].slice(0, most);
};

type Tools = { readonly main: string; readonly repo: string; readonly modules: string };

const worktree = Effect.fn("replay.worktree")(function* (tools: Tools, base: string, name: string, ref: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = `${base}/${name}`;

  yield* Effect.acquireRelease(
    must(`no worktree of ${ref}`, tools.main, "git", ["worktree", "add", "-q", "--detach", dir, ref]),
    () => run("git", ["worktree", "remove", "--force", dir], tools.main).pipe(Effect.ignore),
  );

  yield* fs
    .symlink(tools.modules, `${dir}/node_modules`)
    .pipe(Effect.mapError(failed(`node_modules cannot be linked into ${dir}`)));

  return dir;
});

/** What the signed-commit driver prints: its one JSON line. */
const Signed = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ absent: Schema.Literal(true) }),
    Schema.Struct({ unsigned: Schema.Array(Schema.String) }),
    Schema.Struct({ unreadable: Schema.String }),
  ]),
);

/**
 * The JavaScript that runs one version's own `unsignedCommits` on one pull request's head and prints one JSON line.
 * It is text for `node --input-type=module -e`, run in the version's worktree so that version's own land.ts and its
 * own packages load, and a land.ts from before the check has none to run.
 */
export const signedDriver = (landTs: string, tree: string, oid: string): string =>
  [
    `import * as land from ${JSON.stringify(`file://${landTs}`)};`,
    'import { Effect } from "effect";',
    'import { NodeServices } from "@effect/platform-node";',
    'if (typeof land.unsignedCommits !== "function") {',
    "  console.log(JSON.stringify({ absent: true }));",
    "} else {",
    `  const found = await Effect.runPromise(land.unsignedCommits(${JSON.stringify(tree)}, ${JSON.stringify(oid)}).pipe(`,
    "    Effect.provide(NodeServices.layer),",
    "    Effect.match({",
    "      onFailure: (e) => ({ unreadable: String(e && e.reason ? e.reason : e) }),",
    "      onSuccess: (unsigned) => ({ unsigned }),",
    "    }),",
    "  ));",
    "  console.log(JSON.stringify(found));",
    "}",
  ].join("\n");

/** What the signed-commit driver said, from its exit code and output: a failure to run is unread, never a pass. */
export const readSigned = (pr: number, code: number, stdout: string, stderr: string): Outcome => {
  const line = stdout.trimEnd().split("\n").at(-1) ?? "";
  const read = Schema.decodeUnknownOption(Signed)(line);

  if (code !== 0 || Option.isNone(read)) {
    return {
      refusals: [],
      unreadable: [`the signed-commit check did not answer (exit ${code}): ${oneLine(stderr || stdout, 160)}`],
    };
  }

  const said = read.value;

  return "unsigned" in said
    ? { refusals: signedRefusal(pr, said.unsigned), unreadable: [] }
    : "unreadable" in said
      ? { refusals: [], unreadable: [`the signed-commit check could not run: ${oneLine(said.unreadable, 160)}`] }
      : { refusals: [], unreadable: [] };
};

const merge = (a: Outcome, b: Outcome): Outcome => ({
  refusals: [...a.refusals, ...b.refusals],
  unreadable: [...a.unreadable, ...b.unreadable],
});

const unread = (reason: string): Outcome => ({ refusals: [], unreadable: [reason] });

/**
 * One version of the land check on one pull request, run for real in that version's worktree: `land.ts check <pr>`
 * as the lead runs it, and apart from it the signed-commit check, since `check` stops at its first refusal and a
 * refusal that hides another would hide the one under test.
 */
const probeFor = (trees: Readonly<Record<Version, string>>): Probe =>
  Effect.fnUntraced(function* (kind: Kind, version: Version, target: Target) {
    const tree = trees[version];

    if (Replay.guards.none(kind.replay)) {
      return { refusals: [], unreadable: [] } satisfies Outcome;
    }

    const landTs = `${tree}/${LEAD}land.ts`;

    const asLead = yield* run(
      "nice",
      ["-n", "15", process.execPath, landTs, "check", String(target.number)],
      tree,
    ).pipe(
      Effect.map((ran) => readCheck(target.number, ran.code, ran.err)),
      Effect.orElseSucceed(() => unread("land.ts check could not start")),
    );

    const own = yield* run(
      "nice",
      ["-n", "15", process.execPath, "--input-type=module", "-e", signedDriver(landTs, tree, target.oid)],
      tree,
    ).pipe(
      Effect.map((ran) => readSigned(target.number, ran.code, ran.out, ran.err)),
      Effect.orElseSucceed(() => unread("the signed-commit check could not start")),
    );

    return merge(asLead, own);
  });

/** The pull requests to replay against: the last `merged` that landed, then every open one. */
const pullRequests = Effect.fn("replay.targets")(function* (tools: Tools, merged: number, except: number | undefined) {
  const subjects = (yield* must("main's history does not read", tools.main, "git", [
    "log",
    "origin/main",
    "--first-parent",
    "-n",
    String(merged * 5 + 20),
    "--format=%s",
  ])).split("\n");

  const landed: Array<Target> = [];

  for (const number of mergedNumbers(subjects, merged)) {
    const view = Schema.decodeUnknownOption(View)(
      yield* must(`pr ${number} does not read`, tools.main, "gh", [
        "pr",
        "view",
        String(number),
        "-R",
        tools.repo,
        "--json",
        "headRefOid,state",
      ]),
    );

    if (Option.isSome(view) && view.value.state === "MERGED") {
      landed.push({ number, oid: view.value.headRefOid, state: "MERGED" });
    }
  }

  const open = Schema.decodeUnknownOption(Listed)(
    yield* must("the open pull requests do not read", tools.main, "gh", [
      "pr",
      "list",
      "-R",
      tools.repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,headRefOid",
    ]),
  );

  if (Option.isNone(open)) {
    return yield* ReplayFailed.make({ reason: "the open pull request list is not the shape gh gives" });
  }

  return [...landed, ...open.value.map((p): Target => ({ number: p.number, oid: p.headRefOid, state: "OPEN" }))].filter(
    (t) => t.number !== except,
  );
});

type Ask = {
  readonly pr: Option.Option<number>;
  readonly head: Option.Option<string>;
  readonly base: Option.Option<string>;
  readonly merged: number;
};

const replay = Effect.fn("replay.run")(function* (ask: Ask) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here = import.meta.dirname;

  const common = yield* must("this is no git checkout", here, "git", [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);

  const main = path.dirname(common);
  const origin = yield* must("origin does not read", main, "git", ["remote", "get-url", "origin"]);
  const repo = process.env.GH_REPO ?? repoFromUrl(origin);

  if (repo === null) {
    return yield* ReplayFailed.make({ reason: "origin is not a GitHub repo" });
  }

  const tools: Tools = { main, repo, modules: path.resolve(here, "../../../../node_modules") };
  yield* must("origin/main could not be fetched", main, "git", ["fetch", "-q", "origin", "main"]);

  const base = yield* must("the base does not read", main, "git", [
    "rev-parse",
    `${Option.getOrElse(ask.base, () => "origin/main")}^{commit}`,
  ]);

  const head = yield* Option.match(ask.pr, {
    onSome: (pr) =>
      Effect.gen(function* () {
        const view = yield* must(`pr ${pr} does not read`, main, "gh", [
          "pr",
          "view",
          String(pr),
          "-R",
          repo,
          "--json",
          "headRefOid,state",
        ]);

        const read = Schema.decodeUnknownOption(View)(view);

        if (Option.isNone(read)) {
          return yield* ReplayFailed.make({ reason: `pr ${pr} is not the shape gh gives` });
        }

        yield* must(`pr ${pr}'s head could not be fetched`, main, "git", [
          "fetch",
          "-q",
          "origin",
          read.value.headRefOid,
        ]);

        return read.value.headRefOid;
      }),
    onNone: () =>
      Option.match(ask.head, {
        onSome: (ref) => must("the head does not read", main, "git", ["rev-parse", `${ref}^{commit}`]),
        onNone: () => ReplayFailed.make({ reason: "name a pull request, or --head <ref>" }),
      }),
  });

  const touched = (yield* must("the change does not read", main, "git", ["diff", "--name-only", `${base}...${head}`]))
    .split("\n")
    .filter((p) => p !== "");

  const kinds = changedChecks(touched);

  if (kinds.length === 0) {
    yield* Console.log(nothingChanged);

    return 0;
  }

  const targets = yield* pullRequests(tools, ask.merged, Option.getOrUndefined(ask.pr));

  const replayed = yield* Effect.gen(function* () {
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "replay-" })
      .pipe(Effect.mapError(failed("no scratch folder")));

    const trees = {
      head: yield* worktree(tools, scratch, "head", head),
      base: yield* worktree(tools, scratch, "base", base),
    };

    return yield* replayAll({ kinds, targets, probe: probeFor(trees) });
  }).pipe(Effect.scoped);

  const said = report({ ...replayed, targets: targets.length });
  yield* Console.log(said.lines.join("\n"));

  return said.code;
});

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const command = Command.make(
  "replay",
  {
    pr: Argument.Int("pr").pipe(Argument.optional),
    head: Flag.String("head").pipe(Flag.optional),
    base: Flag.String("base").pipe(Flag.optional),
    merged: Flag.Int("merged").pipe(Flag.withDefault(20)),
  },
  (ask) =>
    replay(ask).pipe(
      Effect.catch((e) => Effect.as(Console.log(`replay: cannot tell: ${e.reason}`), 1)),
      Effect.flatMap(setExit),
    ),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(command, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
    { disableErrorReporting: true },
  );
}
