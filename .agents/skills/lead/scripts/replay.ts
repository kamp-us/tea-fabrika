// replay.ts: run a changed check against the repo's real pull requests before it lands (ticket 1302). Today's
// lead tooling, run on our own laptop; it is not product.
//
// Three checks landed in one week that refused real, correct pull requests the first time they ran (the
// slow-test reporter turned main red, the survivor gate refused its own cap, the signed-commit check refused
// every fix round). Each passed its own tests and its review, because both use made-up cases. This runs the
// changed check on the real ones.
//
//   nice -n 15 node .agents/skills/lead/scripts/replay.ts <pr> [flags]
//   nice -n 15 node .agents/skills/lead/scripts/replay.ts --head <ref> [--base <ref>] [flags]
//   flags: --merged <n> (20)  --check <id> (repeat)  --cap <n> (8)  --retries <n> (3); `--help` says what each does.
//
// `<pr>` names the pull request that changes a check. `--head` names a commit instead, for a change that
// has no pull request yet or one that merged already; `--base` is where the change starts (default
// origin/main). A check's files are every file in its folder that is no test file, test helper or fixture; the
// checks the change touches are named from them:
//
//   land           land.ts, leakgrep.sh, pr/, ci/ (lead scripts)  replayed for real: git and GitHub are read as they are
//   oxlint         oxlint-plugins/, .oxlintrc.json                replayed: each old pull request's changed files, at its
//                                                                 merge commit, linted by this version and by the base's
//   survivors      mutation/scripts/, mutbox.ts                   replayed: `pick` (file scope and cap) on each pull request's
//                                                                 changed files; its exit rules are listed as not replayed
//   stepcommit     step-commit/scripts/                           listed as "not replayed", with its reason
//   reporters      .github/ci/*reporter.ts, vitest.hostrun.ts     listed as "not replayed", with its reason and the one upload that would fix it
//   gates          the rest of .github/ci/, .github/workflows/    listed as "not replayed", with its reason
//
// A change that touches none of them prints that and exits 0. `--check <id>` replays only that check, and each other
// check the change touches is listed as "not replayed (left out by --check)". With a pull request, the checks it
// touches come from `git diff <base>...<pr head>`; with `--head`, from `git diff <base> <head>`, what the head's tree
// changes in the base's, so a commit that main already holds can be compared with main's newer check.
//
// What a replay does, one pull request at a time, under `nice -n 15`, with no CI run and no test run:
//   1. makes two scratch worktrees, the change's head and the base (`<base>`, origin/main unless told),
//      links this repo's node_modules into each, and removes both when it ends; a lint replay makes one more,
//      at the old pull request, for the length of that run;
//   2. takes the last `--merged` pull requests that landed on main (default 20, read from main's own
//      history, each at its merge commit) and every open one at its head, the pull request being replayed excepted;
//   3. runs the head's version of the check on each; only a pull request it refuses gets the base's version
//      too, so a refusal main also gives is told from a new one.
// The land check runs two ways, since `land.ts check` stops at its first refusal and a refusal that hides
// another would hide the very one under test: `land.ts check <pr>` as the lead runs it, and the version's own
// `unsignedCommits` on the pull request's head, run by a child node in that version's worktree. A probe whose answer
// holds a `gh` or GitHub failure (an HTTP 502, a failed exit) is tried `--retries` more times; trouble that stays is
// listed as "not replayed" with its reason, never as a refusal.
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
import type { Duration } from "effect";
import { Console, Effect, Exit, FileSystem, Option, Path, Ref, Schema, Scope } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { run } from "./pr/command.ts";
import { repoFromUrl } from "./pr/PullRequestsGh.ts";

// ---------------------------------------------------------------- the checks a change can touch

/** How a kind of check is replayed: `land`, `oxlint` and `scope` are real replays; `none` gives the reason it is not one. */
export const Replay = Schema.TaggedUnion({ land: {}, oxlint: {}, scope: {}, none: { reason: Schema.String } });

export type Replay = typeof Replay.Type;

/** One kind of check, the paths that make it, and how it is replayed. */
export type Kind = {
  readonly id: string;
  readonly label: string;
  readonly matches: (path: string) => boolean;
  readonly replay: Replay;
  /** What a replay of this kind still cannot see, listed as "not replayed" whenever the kind is replayed. */
  readonly gap?: string;
};

/** A test file, a test helper or a fixture: what a check's folder holds that is no part of the check. */
const isLaw = (path: string) =>
  /\.(test|test-support|integration\.test)\.[cm]?[jt]s$/.test(path) ||
  /(^|\/)(test-helpers|fixtures)\//.test(path) ||
  /Test\.ts$/.test(path);

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
        p.startsWith(`${LEAD}pr/`) ||
        p.startsWith(`${LEAD}ci/`)),
    replay: Replay.cases.land.make({}),
  },
  {
    id: "stepcommit",
    label: "stepcommit.sh",
    matches: (p) => !isLaw(p) && p.startsWith(".agents/skills/step-commit/scripts/"),
    replay: notReplayed(
      "it checks the files a step is about to commit in a working tree; no saved pull request data holds that, and replaying it means redoing each pull request's commits",
    ),
  },
  {
    id: "survivors",
    label: "the survivor gate",
    matches: (p) => !isLaw(p) && (p.startsWith(".agents/skills/mutation/scripts/") || p === `${LEAD}mutbox.ts`),
    replay: Replay.cases.scope.make({}),
    gap: "the survivor gate's exit rules (a mutant that lived, a file no law loads) need a mutation run's results; CI keeps no mutbox artifact, and the 61 mutbox.json files in the boxes folder are one-off runs of other changes, so only its file scope and cap are replayed",
  },
  {
    id: "oxlint",
    label: "the oxlint plugins",
    matches: (p) => !isLaw(p) && (p === ".oxlintrc.json" || p.startsWith("oxlint-plugins/")),
    replay: Replay.cases.oxlint.make({}),
    gap: "only `oxlint-plugins/lint.ts` on the files each pull request changed, as it stood at that pull request; not the whole-repo lint (ledger pruning, dead code, layers, stylelint)",
  },
  {
    id: "reporters",
    label: "the vitest reporters",
    matches: (p) => !isLaw(p) && (/^\.github\/ci\/([^/]*-)?reporter\.ts$/.test(p) || p === "vitest.hostrun.ts"),
    replay: notReplayed(
      "a reporter reads a live run, each test with the time limit it ran under. CI saves per-file seconds (`timings-*`) and, for a pull request's related tests, the vitest JSON (`results-related-*`, 7 days): per-test durations but no limit, which the slow-test reporter judges against. One small upload would make it replayable: the reporter writes its `Timed` rows (file, name, ms, limit) to a JSON file and the test legs upload it, as they upload `timings-*`",
    ),
  },
  {
    id: "gates",
    label: "the CI gate scripts",
    matches: (p) => !isLaw(p) && (p.startsWith(".github/ci/") || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)),
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

/**
 * A pull request to replay against: its head, the tree to read it in (the merge commit of a merged one, the head
 * of an open one) and the files it changed.
 */
export type Target = {
  readonly number: number;
  readonly oid: string;
  readonly state: "OPEN" | "MERGED";
  readonly tree: string;
  readonly files: ReadonlyArray<string>;
};

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
type Replayed = {
  readonly found: ReadonlyArray<Found>;
  readonly notReplayed: ReadonlyArray<string>;
  readonly leftOut: ReadonlyArray<string>;
};

/**
 * The head's version of each replayed kind on each target, one at a time. Only a target the head refuses
 * gets the base's version too. A kind with no replay is listed with its reason and never run; a target a
 * kind could not be read on is listed with that reason.
 */
export const replayAll = Effect.fn("replay.replayAll")(function* (a: {
  readonly kinds: ReadonlyArray<Kind>;
  readonly targets: ReadonlyArray<Target>;
  readonly probe: Probe;
  /** The touched kinds `--check` left out: listed, never run. */
  readonly leftOut?: ReadonlyArray<Kind>;
}) {
  const found: Array<Found> = [];
  const gaps: Array<string> = [];

  for (const kind of a.kinds) {
    if (Replay.guards.none(kind.replay)) {
      gaps.push(`${kind.label}: ${kind.replay.reason}`);
      continue;
    }

    if (kind.gap !== undefined) {
      gaps.push(`${kind.label}: ${kind.gap}`);
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

  return { found, notReplayed: gaps, leftOut: (a.leftOut ?? []).map((k) => k.label) } satisfies Replayed;
});

/**
 * A probe that tries again, `again` more times and `pause` apart, while its answer holds GitHub's trouble; the last
 * answer stands, so trouble that stays is listed as not read, never as a refusal.
 */
export const settled =
  (probe: Probe, again: number, pause: Duration.Input): Probe =>
  (kind, version, target) =>
    Effect.gen(function* () {
      let answer = yield* probe(kind, version, target);

      for (let tried = 0; tried < again && flaky(answer); tried += 1) {
        yield* Effect.sleep(pause);
        answer = yield* probe(kind, version, target);
      }

      return answer;
    });

/** The touched kinds `--check` keeps to replay, and the ones it leaves out; no ids keeps every one. */
export const choose = (
  touched: ReadonlyArray<Kind>,
  only: ReadonlyArray<string>,
): { readonly run: ReadonlyArray<Kind>; readonly leftOut: ReadonlyArray<Kind> } =>
  only.length === 0
    ? { run: touched, leftOut: [] }
    : { run: touched.filter((k) => only.includes(k.id)), leftOut: touched.filter((k) => !only.includes(k.id)) };

const oneLine = (text: string, most = 400) => {
  const flat = text.replace(/\s+/g, " ").trim();

  return flat.length > most ? `${flat.slice(0, most)}...` : flat;
};

/**
 * The lines to print and the exit code: 1 only when a refusal is new. A new refusal is one line each; the refusals the
 * base gives too are one line for each pull request and check, with their count and the first.
 */
export const report = (a: Replayed & { readonly targets: number }): { lines: ReadonlyArray<string>; code: 0 | 1 } => {
  const fresh = a.found.filter((f) => f.fresh).length;
  const same = new Map<string, Array<Found>>();

  for (const f of a.found.filter((g) => !g.fresh)) {
    same.set(`${f.pr}\u0000${f.check}`, [...(same.get(`${f.pr}\u0000${f.check}`) ?? []), f]);
  }

  return {
    lines: [
      ...a.found.filter((f) => f.fresh).map((f) => `refused: pr ${f.pr} [${f.check}] new: ${oneLine(f.reason)}`),
      ...[...same.values()].map(
        ([first, ...rest]) =>
          `refused: pr ${first?.pr} [${first?.check}] also on main: ${rest.length + 1} refusal(s), the first: ${oneLine(first?.reason ?? "")}`,
      ),
      ...a.notReplayed.map((reason) => `not replayed: ${oneLine(reason)}`),
      ...a.leftOut.map((label) => `not replayed (left out by --check): ${label}`),
      `replay: ${fresh} new refusal(s), ${a.found.length - fresh} also on main, over ${a.targets} pull request(s)`,
    ],
    code: fresh > 0 ? 1 : 0,
  };
};

/** The line for a change that touches no check. */
const nothingChanged = "replay: the change touches no check replay knows; nothing to replay";

// ---------------------------------------------------------------- the land check, for real

const REFUSED = /^land: refused at the (\w+) check: (.*)$/;

/**
 * Trouble with GitHub and not a verdict on a pull request: `gh` failed to answer (an HTTP error, a failed exit, a rate
 * limit, no network). Such a line may sit inside any refusal reason, as `land.ts check` words a failed read.
 */
export const GITHUB_TROUBLE =
  /\bgh\b[^\n]*?(exited \d+|HTTP [45]\d\d|Server Error|Bad Gateway|rate limit|timed out|Could not resolve host)/i;

/** The start of every unreadable line that GitHub's trouble made, which `settled` tries again. */
export const GITHUB_FAILED = "gh failed: ";

/** Whether a probe's answer holds GitHub's trouble, so another try may read what this one could not. */
export const flaky = (outcome: Outcome): boolean => outcome.unreadable.some((u) => u.startsWith(GITHUB_FAILED));

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

  if (GITHUB_TROUBLE.test(reason)) {
    return { refusals: [], unreadable: [`${GITHUB_FAILED}${oneLine(reason, 200)}`] };
  }

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

/** A pull request that landed on main, and the squash commit it landed as. */
export type Landed = { readonly number: number; readonly commit: string };

/**
 * The pull requests in main's first-parent history, newest first, each once, from `<sha> <subject>` lines: a squash
 * merge ends its subject in `(#<n>)`.
 */
export const merges = (lines: ReadonlyArray<string>, most: number): ReadonlyArray<Landed> => {
  const seen = new Map<number, string>();

  for (const line of lines) {
    const [commit = "", ...subject] = line.split(" ");
    const n = /\(#(\d+)\)\s*$/.exec(subject.join(" "))?.[1];

    if (n !== undefined && !seen.has(Number(n))) {
      seen.set(Number(n), commit);
    }
  }

  return [...seen].slice(0, most).map(([number, commit]) => ({ number, commit }));
};

/** The files a lint run takes: source files of a language oxlint reads, that the pull request's tree still holds. */
export const lintable = (files: ReadonlyArray<string>, tree: ReadonlySet<string>): ReadonlyArray<string> =>
  files.filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f) && tree.has(f));

/** The most files one lint run takes, so a pull request that changed a thousand does not hold the laptop. */
export const LINT_FILES = 150;

/**
 * What `oxlint-plugins/lint.ts <files>` said, from its exit code and output: each line it blocks on is a refusal of the
 * pull request (a line of advice is not, since the lint passes it), and a failure with no such line is unread.
 */
export const readLint = (pr: number, code: number, stdout: string, stderr: string): Outcome => {
  const blocking = stdout
    .split("\n")
    .filter((line) => /^\S+:\d+:\d+ /.test(line) && !line.includes(" advice, "))
    .map((line) => line.trim());

  if (blocking.length > 0) {
    return { refusals: blocking.map((reason) => ({ pr, check: "oxlint plugins", reason })), unreadable: [] };
  }

  return code === 0
    ? { refusals: [], unreadable: [] }
    : unread(`lint.ts exited ${code} and named no line: ${oneLine(stderr || stdout, 160)}`);
};

/** The cap a survivors.ts holds for the files one run takes: its `MUTATE_FILES` default, or none when it holds none. */
export const capFrom = (source: string): number | null => {
  const found = /"MUTATE_FILES"\)\.pipe\(\s*Config\.withDefault\((\d+)\)/.exec(source)?.[1];

  return found === undefined ? null : Number(found);
};

/** What the scope driver prints: its one JSON line. */
const Scoped = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ absent: Schema.Literal(true) }),
    Schema.Struct({ files: Schema.Int }),
    Schema.Struct({ refused: Schema.String }),
  ]),
);

/**
 * The JavaScript that runs one version's own `pick` (the files the survivor gate mutates) on one pull request's changed
 * files and prints one JSON line. Text for `node --input-type=module -e`, in the version's worktree; its input comes on
 * stdin as JSON `{ changed, tree, cap }`.
 */
export const scopeDriver = (survivorsTs: string): string =>
  [
    `import * as survivors from ${JSON.stringify(`file://${survivorsTs}`)};`,
    'import { readFileSync } from "node:fs";',
    'import { Result } from "effect";',
    'if (typeof survivors.pick !== "function") {',
    "  console.log(JSON.stringify({ absent: true }));",
    "} else {",
    '  const ask = JSON.parse(readFileSync(0, "utf8"));',
    "  const picked = survivors.pick({ changed: ask.changed, named: null, tree: new Set(ask.tree), cap: ask.cap });",
    "  console.log(JSON.stringify(Result.isFailure(picked) ? { refused: picked.failure.detail } : { files: picked.success.length }));",
    "}",
  ].join("\n");

/** What the scope driver said: a refusal of `pick` is the pull request's, and a driver that failed is unread. */
export const readScope = (pr: number, code: number, stdout: string, stderr: string): Outcome => {
  const read = Schema.decodeUnknownOption(Scoped)(stdout.trimEnd().split("\n").at(-1) ?? "");

  if (code !== 0 || Option.isNone(read)) {
    return unread(`the survivor scope check did not answer (exit ${code}): ${oneLine(stderr || stdout, 160)}`);
  }

  return "refused" in read.value
    ? { refusals: [{ pr, check: "survivor scope", reason: read.value.refused }], unreadable: [] }
    : { refusals: [], unreadable: [] };
};

type Tools = { readonly main: string; readonly repo: string; readonly modules: string };

const worktree = Effect.fn("replay.worktree")(function* (
  world: Pick<World, "tools" | "fs" | "scratch">,
  name: string,
  ref: string,
) {
  const dir = `${world.scratch}/${name}`;

  yield* Effect.acquireRelease(
    must(`no worktree of ${ref}`, world.tools.main, "git", ["worktree", "add", "-q", "--detach", dir, ref]),
    () => run("git", ["worktree", "remove", "--force", dir], world.tools.main).pipe(Effect.ignore),
  );

  yield* world.fs
    .symlink(world.tools.modules, `${dir}/node_modules`)
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

/** The folders a replay works in: this repo's main checkout and node_modules, the scratch folder, and the commits to compare. */
type Held = { readonly pr: number; readonly dir: string; readonly scope: Scope.Closeable } | null;

type World = {
  readonly tools: Tools;
  readonly fs: FileSystem.FileSystem;
  readonly scratch: string;
  readonly trees: Readonly<Record<Version, string>>;
  readonly commits: Readonly<Record<Version, string>>;
  readonly pluginModules: string;
  readonly cap: number;
  /** The lint's worktree of the pull request it last ran on, kept for the base's run on the same one. */
  readonly held: Ref.Ref<Held>;
};

const land = (world: World, version: Version, target: Target) =>
  Effect.gen(function* () {
    const tree = world.trees[version];
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

/** The files a pull request's tree holds. */
const treeFiles = Effect.fnUntraced(function* (world: World, tree: string) {
  return new Set(
    (yield* must("a tree does not read", world.tools.main, "git", ["ls-tree", "-r", "--name-only", tree])).split("\n"),
  );
});

/**
 * The worktree of one pull request's tree, with the plugin modules linked in: the one the last lint run made when it
 * was for this same pull request (the base's run follows the head's), else a new one, the old one closed.
 */
const lintTree = (world: World, target: Target) =>
  Effect.gen(function* () {
    const held = yield* Ref.get(world.held);

    if (held !== null && held.pr === target.number) {
      return held.dir;
    }

    if (held !== null) {
      yield* Scope.close(held.scope, Exit.void);
      yield* Ref.set(world.held, null);
    }

    const scope = yield* Scope.make();

    const dir = yield* worktree(world, `lint-${target.number}`, target.tree).pipe(
      Effect.provideService(Scope.Scope, scope),
    );

    yield* world.fs
      .symlink(world.pluginModules, `${dir}/oxlint-plugins/node_modules`)
      .pipe(Effect.mapError(failed("oxlint-plugins/node_modules cannot be linked")));

    yield* Ref.set(world.held, { pr: target.number, dir, scope });

    return dir;
  });

/**
 * One version of the oxlint plugins on the files one pull request changed, in a worktree of that pull request's own
 * tree with this version's `oxlint-plugins/` and `.oxlintrc.json` laid over it.
 */
const lint = (world: World, version: Version, target: Target) =>
  Effect.gen(function* () {
    const files = lintable(target.files, yield* treeFiles(world, target.tree));
    const taken = files.slice(0, LINT_FILES);

    if (taken.length === 0) {
      return { refusals: [], unreadable: [] } satisfies Outcome;
    }

    const dir = yield* lintTree(world, target);

    yield* must("the plugins could not be laid over the tree", dir, "sh", [
      "-c",
      'find oxlint-plugins -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && rm -f .oxlintrc.json && git -C "$0" archive "$1" oxlint-plugins .oxlintrc.json | tar -x -f -',
      world.tools.main,
      world.commits[version],
    ]);

    const ran = yield* run("nice", ["-n", "15", process.execPath, "oxlint-plugins/lint.ts", ...taken], dir).pipe(
      Effect.mapError(failed("lint.ts could not start")),
    );

    const read = readLint(target.number, ran.code, ran.out, ran.err);

    return files.length > taken.length
      ? {
          ...read,
          unreadable: [...read.unreadable, `${files.length} files changed; the first ${taken.length} were linted`],
        }
      : read;
  });

/** One version of the survivor gate's file scope and cap on the files one pull request changed. */
const scope = (world: World, version: Version, target: Target) =>
  Effect.gen(function* () {
    const survivorsTs = `${world.trees[version]}/.agents/skills/mutation/scripts/survivors.ts`;
    const source = yield* world.fs.readFileString(survivorsTs).pipe(Effect.orElseSucceed(() => ""));
    const cap = capFrom(source) ?? world.cap;
    const tree = yield* treeFiles(world, target.tree);

    const ran = yield* run(
      "nice",
      ["-n", "15", process.execPath, "--input-type=module", "-e", scopeDriver(survivorsTs)],
      world.trees[version],
      { stdin: JSON.stringify({ changed: target.files, tree: [...tree], cap }) },
    ).pipe(Effect.mapError(failed("the survivor scope check could not start")));

    return readScope(target.number, ran.code, ran.out, ran.err);
  });

/** The real replay: each kind's own check, one version, one pull request. A failure to run it is unread, never a pass. */
const probeFor =
  (world: World): Probe =>
  (kind, version, target) =>
    Replay.match(kind.replay, {
      land: () => land(world, version, target),
      oxlint: () => lint(world, version, target),
      scope: () => scope(world, version, target),
      none: () => Effect.succeed({ refusals: [], unreadable: [] } satisfies Outcome),
    }).pipe(
      Effect.catch((e) => Effect.succeed(unread(e instanceof ReplayFailed ? e.reason : "the check could not run"))),
    );

/** The pull requests to replay against: the last `merged` that landed, then every open one. */
const pullRequests = Effect.fn("replay.targets")(function* (tools: Tools, merged: number, except: number | undefined) {
  const lines = (yield* must("main's history does not read", tools.main, "git", [
    "log",
    "origin/main",
    "--first-parent",
    "-n",
    String(merged * 5 + 20),
    "--format=%H %s",
  ])).split("\n");

  const changed = (from: string, to: string) =>
    must("a change does not read", tools.main, "git", ["diff", "--name-only", from, to]).pipe(
      Effect.map((out) => out.split("\n").filter((p) => p !== "")),
    );

  const landed: Array<Target> = [];

  for (const { number, commit } of merges(lines, merged)) {
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
      landed.push({
        number,
        oid: view.value.headRefOid,
        state: "MERGED",
        tree: commit,
        files: yield* changed(`${commit}^`, commit),
      });
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

  const opened: Array<Target> = [];

  for (const p of open.value.filter((o) => o.number !== except)) {
    yield* must(`pr ${p.number}'s head could not be fetched`, tools.main, "git", [
      "fetch",
      "-q",
      "--no-write-fetch-head",
      "origin",
      p.headRefOid,
    ]);

    const from = yield* must("a merge base does not read", tools.main, "git", [
      "merge-base",
      "origin/main",
      p.headRefOid,
    ]);

    opened.push({
      number: p.number,
      oid: p.headRefOid,
      state: "OPEN",
      tree: p.headRefOid,
      files: yield* changed(from, p.headRefOid),
    });
  }

  return [...landed.filter((t) => t.number !== except), ...opened];
});

type Ask = {
  readonly pr: Option.Option<number>;
  readonly head: Option.Option<string>;
  readonly base: Option.Option<string>;
  readonly merged: number;
  readonly only: ReadonlyArray<string>;
  readonly cap: number;
  readonly retries: number;
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
  yield* must("origin/main could not be fetched", main, "git", [
    "fetch",
    "-q",
    "--no-write-fetch-head",
    "origin",
    "main",
  ]);

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
          "--no-write-fetch-head",
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

  // A pull request's own change is what it adds to main (three dots); a bare commit is compared as it is (two).
  const range = Option.isSome(ask.pr) ? [`${base}...${head}`] : [base, head];

  const touched = (yield* must("the change does not read", main, "git", ["diff", "--name-only", ...range]))
    .split("\n")
    .filter((p) => p !== "");

  const unknown = ask.only.filter((id) => !KINDS.some((k) => k.id === id));

  if (unknown.length > 0) {
    return yield* ReplayFailed.make({
      reason: `no such check to replay: ${unknown.join(", ")}; the ids are ${KINDS.map((k) => k.id).join(", ")}`,
    });
  }

  const touchedKinds = changedChecks(touched);
  const { run: kinds, leftOut } = choose(touchedKinds, ask.only);

  if (touchedKinds.length === 0) {
    yield* Console.log(nothingChanged);

    return 0;
  }

  // Nothing to replay when `--check` kept none of the touched kinds: no pull request is read for it.
  const targets = kinds.length === 0 ? [] : yield* pullRequests(tools, ask.merged, Option.getOrUndefined(ask.pr));

  const replayed = yield* Effect.gen(function* () {
    const scratch = yield* fs
      .makeTempDirectoryScoped({ prefix: "replay-" })
      .pipe(Effect.mapError(failed("no scratch folder")));

    const room = { tools, fs, scratch };

    const world: World = {
      ...room,
      trees: { head: yield* worktree(room, "head", head), base: yield* worktree(room, "base", base) },
      commits: { head, base },
      pluginModules: path.resolve(here, "../../../../oxlint-plugins/node_modules"),
      cap: ask.cap,
      held: yield* Ref.make<Held>(null),
    };

    // The lint's last worktree is removed with the two others.
    yield* Effect.addFinalizer(() =>
      Ref.get(world.held).pipe(
        Effect.flatMap((held) => (held === null ? Effect.void : Scope.close(held.scope, Exit.void))),
      ),
    );

    return yield* replayAll({
      kinds,
      targets,
      probe: settled(probeFor(world), ask.retries, "2 seconds"),
      leftOut,
    });
  }).pipe(Effect.scoped);

  const said = report({ ...replayed, targets: targets.length });
  yield* Console.log(said.lines.join("\n"));

  return said.code;
});

const setExit = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

/** The files cap a run uses when a version's survivors.ts shows no `MUTATE_FILES` default of its own. */
export const DEFAULT_CAP = 8;

/** How many more times a probe is tried when GitHub fails to answer, and how many pull requests are replayed. */
export const DEFAULT_RETRIES = 3;

export const DEFAULT_MERGED = 20;

const command = Command.make(
  "replay",
  {
    pr: Argument.Int("pr").pipe(
      Argument.withDescription("the pull request that changes a check (or give --head)"),
      Argument.optional,
    ),
    head: Flag.String("head").pipe(
      Flag.withDescription("a commit to replay in place of a pull request; compared with --base as two trees"),
      Flag.optional,
    ),
    base: Flag.String("base").pipe(
      Flag.withDescription("where the change starts (default origin/main)"),
      Flag.optional,
    ),
    merged: Flag.Int("merged").pipe(
      Flag.withDescription(
        `how many of the last merged pull requests to replay on (default ${DEFAULT_MERGED}); every open one is`,
      ),
      Flag.withDefault(DEFAULT_MERGED),
    ),
    only: Flag.String("check").pipe(
      Flag.withDescription(
        "replay only this check: land, oxlint, survivors, stepcommit, reporters or gates (repeat for several); the other touched checks are listed as left out",
      ),
      Flag.atLeast(0),
    ),
    cap: Flag.Int("cap").pipe(
      Flag.withDescription(
        `the survivor gate's files cap, used when a version's survivors.ts shows no MUTATE_FILES default (default ${DEFAULT_CAP})`,
      ),
      Flag.withDefault(DEFAULT_CAP),
    ),
    retries: Flag.Int("retries").pipe(
      Flag.withDescription(
        `how many more times to try a probe whose answer holds a gh or GitHub failure, 2 seconds apart (default ${DEFAULT_RETRIES}); trouble that stays is listed as not replayed`,
      ),
      Flag.withDefault(DEFAULT_RETRIES),
    ),
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
