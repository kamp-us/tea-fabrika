// land.ts: the lead session lands one quest. Today's lead tooling, run on our own laptop; it is not
// product (ticket 652).
//
// A quest agent never runs a lead-only step: the session's permission check refuses it the lead
// key, and rightly (the lead runs a refused push or merge of a step itself only in the named cases). So the quest agent's last act is `ready`, and the lead session runs the
// mechanical tail with `run`:
//
//   land.ts ready <quest> --tree <dir> [--body <file> --loosening <file>]
//       [--lead <sha>]... [--plan <file>]
//     the quest agent. Records "ready to land" in BOXES/state/<quest>.land.json and one line in
//     BOXES/state/<quest>.md. The tree must be clean. `--lead` names the quest's own lead commits
//     (field rows, plan rows, a lockfile), made with `stepcommit.sh --commit-only lead`. The two
//     PR files come together or not at all: without them it is a mid-quest handover (a lockfile, a
//     merge of main), which goes only to the branch's -wip backup. It reads no key, pushes nothing
//     and opens nothing.
//
//   land.ts run <quest> <ticket>
//     the lead session, in the background:
//       check        the tree is clean, on the ready branch, at the ready head
//       leak         the PR body that will be posted, through leakgrep.sh --text
//       fetch        origin main
//       merge        main in as the bot, never a rebase; on a conflict, stop and name each file
//                    with the step that owns it in the plan's files table
//       leak         the branch's net change and each commit to send, through leakgrep.sh
//       sign         each named lead commit, oldest first, then the merge, as lead, through main's
//                    own signer; only that signer reads the key
//       push         botpush.mjs, to the branch (to its -wip backup for a mid-quest handover, and
//                    stop there)
//       pr           open the PR from the body file, or update the open one
//       queue        as `land.ts queue <pr> --wait` below
//
//   land.ts queue <pr> [--wait] [--wait-minutes <n>] [--every-seconds <n>]
//     the lead session, for any pull request whose steps passed (pr/Queue.ts, a pull request whose steps passed lands on green CI and a clean leak check alone): first the merge gate
//     below, which refuses one that is closed, not into main, in conflict with main, a `can/` branch or titled `Plan:`, that leaks (the
//     leak grep on its net change, each of its commits and its title and description, which become the squash commit's text), whose
//     body fails the pr skill's checks, or with a commit nothing vouches for; then marks a draft ready for
//     review, as `admin` does, which starts its real `ci-required`; reads `ci-required` at its
//     head, once, or with --wait again each minute for up to an hour, in the background (a draft just
//     marked ready has no `ci-required` yet, so give it --wait; a pull request that conflicts with main, or turns to
//     conflict during the wait, exits 1 at once with the command that merges main in); then one
//     `gh pr merge --squash --match-head-commit <head>`, which adds it to GitHub's merge queue.
//     It prints `queued`, never `merged`: GitHub tests it on newest main and merges it later. No
//     --admin, no --auto, no other merge method.
//
//   land.ts wait <pr> [--wait-minutes <n>] [--every-seconds <n>]
//     the one wait for CI, in place of a hand-written loop that picks a workflow run by head SHA (a ready
//     event starts a second run at one head, and the loop read the first). Reads `ci-required`, the check
//     `land.ts` itself reads, at the head the pull request holds on each read (default 60 minutes, every 60
//     seconds), until it has ended; a push or an update-branch moves the head and the next read follows it.
//     Prints the conclusion and exits 0 on success, 1 on any other (a cancelled one says so and names its
//     run, a pull request that turns to conflict with main ends it at once). `queue --wait` and `admin
//     --wait` make this same wait before they act, and take the same two flags.
//
//   land.ts check <pr>
//     the lead session, after it writes a pull request's body and before `queue`: runs the merge gate (pr/Gate.ts) alone, the one
//     function that `queue`, `run`, `merge`, `merge --admin`, `admin` and `arm` run first, so `check` refuses exactly what each of them
//     refuses before it asks for CI or a merge. In order: not a `can/` branch; open, into main and not in conflict with main (a draft
//     passes: `queue` marks it ready); no `Plan:` title; the leak grep on the net change and each commit; the leak grep on the title and
//     description, the pr skill's sections and no draft placeholder, each new exported name named under `## New names`, and each
//     `fabrika close ticket` line naming an open tracker ticket; and every commit on the branch since main signed (a note on
//     refs/notes/fabrika, or a person's own signature) or made by `stepcommit.sh` (a `--commit-only` commit, signed at
//     `land.ts run`, and a fix round's, which signs nothing), naming each one that is neither. The first refusal is the one printed.
//     Changes nothing but the refs it fetches. Exits 1 on a refusal, naming what is wrong and the file it comes from; else prints
//     one line that lists the checks it passed and exits 0. `queue`, `run`, `merge`, `admin` and `arm` print that same line
//     first (pr/Gate.ts `line`), unless the pull request was found merged already.
//
//   land.ts arm <pr>
//     the lead session, the one way merge when ready is turned on (the lead turns on merge when ready once the steps passed, and GitHub queues it on green; every pull request whose review passed has merge when ready on, and main's full run catches what slips; pr/Arm.ts): runs the merge gate
//     first, as `queue` does (so a `can/` branch, a `Plan:` title, a leak or a grep that could not run, a body the pr skill's checks
//     refuse, an unsigned commit or a conflict with main refuses it); reads the proof run (scheduled.yaml) on its branch at its head, the
//     full set or, since the proof-run rule, the changed set, and refuses one that is red or not ended, printing
//     each job that is not green, its failed steps and its failing test lines. With no run at the
//     head it arms, as the arm-every-reviewed-pull-request rule allows, and says so in one line, unless the branch's newest run at an
//     older head is not green or is a changed-set run, which proves only that head's change. Then
//     marks a draft ready and turns on merge when ready, a squash pinned to the head that was read.
//
//   land.ts merge <pr> [--admin]
//     the lead session, the only way it merges a pull request by hand (pr/Merge.ts); never a bare
//     `gh pr merge`. Without --admin, as `queue`. With --admin, an admin merge past the queue, which
//     skips the queue and never a green check: every one needs `ci-required` green at the head,
//     docs included. It lands a sev fix at either level (a sev fix is admin-merged one at a time on current main: the branch `sev.ts fix` named in a
//     sev1, or one `open --allow` or `next` named in a sev0), a ready pull request a sev0 `allow`ed
//     (no pull request is in a stack, and in a sev0 the lead admin-merges ready ones in order), or any other pull request the owner asked for. A fix also needs origin/main's head in
//     its history. Every one runs the merge gate first, which `queue` and `arm` run too: the leak gate on the change, each commit,
//     the title and the description (a refusal on any hit or on a grep that could not run), and the rest of its refusals.
//
//   land.ts admin <pr> [--wait] [--wait-minutes <n>] [--every-seconds <n>] [--queue-minutes <n>] [--queue-every-seconds <n>]
//     the lead session, the one way it admin merges (a hand-written `gh pr checks --watch` chain once
//     merged while ci-required was still pending). As `merge --admin` (a branch starting
//     `can/` is refused by the gate, as it is on every path), and also: a draft is marked ready after the gate, then ci-required is given
//     --wait-minutes (default 30, read every --every-seconds, default 30) to appear and end, and only
//     once a CI run has started at its head, never in the seconds after a push (a ready event then
//     starts a second run on one commit, and the required check stays "expected"); it must be
//     completed and success at the head read last, which must not move while waiting; one pinned squash
//     with --admin; then it prints the pull request's state and merge commit. An admin merge moves main
//     and restarts the build of every entry in the merge queue, so a pull request that is no sev fix
//     and no ready pull request of a sev0 is refused while the queue holds an entry, naming it; with
//     --wait it reads the queue again every --queue-every-seconds (default 60) for up to
//     --queue-minutes (default 60), in the background, and merges once it is empty. A merge that happened exits 0, even
//     when the read of the pull request after it fails; only a refusal exits 1.
//
//   land.ts merged <pr>...
//     the lead session, later: one read of each pull request, no wait. Merged into main: closes
//     each ticket its description names on a line of its own, `fabrika close ticket <N>`, with a
//     comment naming the pull request and its merge commit (a merge closes only the tickets its pull request names with our own phrase), and starts one box cleanup sweep
//     (`gcloop.ts kick`, box cleanup runs on a timer and after a merge, never on a step's start path), which removes the quest's boxes and worktree. Not merged: one line
//     saying how it stands. Running it again closes nothing twice.
//
//   land.ts close-named <pr>...
//     as `merged`, but only the ticket closes: no box cleanup sweep. For a pull request that merged
//     at GitHub and was never settled, and for the after-fast-forward watcher.
//
// Every refusal of any command exits 1, after one line on stderr that names the check; a caller's `&&`
// stops there.
//
// Every refusal before the push puts the tree's HEAD and refs/notes/fabrika back where they were,
// so a refused run changes nothing. It never resolves a conflict and never reads a key.
//
// Each part is an exported Effect (readReady, checkTree, draftPr, mergeMain, leakCheck, signLead,
// push, openPr, queue), so the lead's flows (the lead drives work by writing a flow that one program runs, and no agent holds a loop, ticket 656) can run them as steps; `run` only
// calls them in order.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array as Arr,
  Console,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Schema,
  Stream,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { Alerts } from "../../sev/scripts/Alerts.ts";
import * as AlertsGh from "../../sev/scripts/AlertsGh.ts";
import * as Level from "../../sev/scripts/Level.ts";
import * as ChecksGh from "./ci/ChecksGh.ts";
import * as RunsGh from "./ci/RunsGh.ts";
import * as Arm from "./pr/Arm.ts";
import * as BranchesGit from "./pr/BranchesGit.ts";
import * as Gate from "./pr/Gate.ts";
import * as MainFetch from "./pr/MainFetch.ts";
import * as Merge from "./pr/Merge.ts";
import { PullRequests } from "./pr/PullRequests.ts";
import * as PullRequestsGh from "./pr/PullRequestsGh.ts";
import { LeakGrepRefused } from "./pr/Pushes.ts";
import * as PushesProcess from "./pr/PushesProcess.ts";
import * as Queue from "./pr/Queue.ts";
import * as Sections from "./pr/Sections.ts";
import { Signatures } from "./pr/Signatures.ts";
import * as SignaturesGit from "./pr/SignaturesGit.ts";
import * as SweepsProcess from "./pr/SweepsProcess.ts";
import * as TicketsCli from "./pr/TicketsCli.ts";

const Check = Schema.Literals([
  "env",
  "ready",
  "check",
  "leak",
  "fetch",
  "merge",
  "sign",
  "push",
  "pr",
  "queue",
  "wait",
  "arm",
  "body",
]);

class Refused extends Schema.TaggedError<Refused>()("Refused", {
  check: Check,
  reason: Schema.String,
  output: Schema.String,
}) {}

const Sha = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

/**
 * The files a PR is made of: its body (first line the title) and the loosening check's output, the
 * one exam output a PR carries (the lead merges once every step passed, and waits on the owner only for real loosening or a new design call, as amended by the scheduled-mutation rule: mutation runs hourly on main, not in a PR).
 */
const PrFiles = Schema.Struct({ body: Schema.String, loosening: Schema.String });

/** What a quest agent hands the lead: the quest, its tree and head, its lead commits, and the PR, if any. */
class Ready extends Schema.Class<Ready>("Ready")({
  quest: Schema.String,
  tree: Schema.String,
  branch: Schema.String,
  head: Sha,
  pr: Schema.optional(PrFiles),
  lead: Schema.Array(Sha),
  plan: Schema.optional(Schema.String),
  sentAt: Schema.String,
}) {}

/**
 * `state/<quest>.land.json`. One written before the rule that a lane is called a quest names the quest `lane`: it reads as
 * `quest`, and a new one says `quest`.
 */
const ReadyJson = Schema.fromJsonString(Schema.Union([Ready, Ready.pipe(Schema.encodeKeys({ quest: "lane" }))]));

const BOT = ["-c", "user.name=fabrikalfa[bot]", "-c", `user.email=${SignaturesGit.BOT_EMAIL}`];

type Ran = { readonly code: number; readonly out: string; readonly err: string };

const text = (s: Stream.Stream<Uint8Array, unknown>) => Stream.mkString(Stream.decodeText(s));

/** One command, run to its end in `cwd`; `stdin` is fed to it when given. */
const sh = Effect.fn("land.sh")(
  function* (cwd: string, cmd: string, args: ReadonlyArray<string>, stdin?: string) {
    const ran = yield* ChildProcess.make(cmd, args, {
      cwd,
      ...(stdin === undefined ? {} : { stdin: Stream.make(new TextEncoder().encode(stdin)) }),
    });

    const [out, err, code] = yield* Effect.all([text(ran.stdout), text(ran.stderr), ran.exitCode], {
      concurrency: 3,
    });

    return { code: Number(code), out, err } satisfies Ran;
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed<Ran>({ code: 127, out: "", err: "the command could not start" })),
);

/** A command that must succeed; else the run is refused at `check`. */
const must = Effect.fnUntraced(function* (
  check: typeof Check.Type,
  reason: string,
  cwd: string,
  cmd: string,
  args: ReadonlyArray<string>,
  stdin?: string,
) {
  const ran = yield* sh(cwd, cmd, args, stdin);

  if (ran.code !== 0) {
    return yield* new Refused({ check, reason, output: `${ran.out}${ran.err}` });
  }

  return ran.out.trim();
});

const HERE = import.meta.dirname;

/** The paths env.sh gives every lead script. */
const loadEnv = Effect.gen(function* () {
  const out = yield* must("env", "env.sh failed", HERE, "sh", [
    "-c",
    // oxlint-disable-next-line no-template-curly-in-string -- sh text: `${VAR:-default}` is the shell's own default
    '. "$0" && printf "%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO" "$FABRIKA_COAUTHOR" "$HOME" "${FABRIKA_HOME:-$HOME/Library/Application Support/@kampus/fabrika-app}"',
    `${HERE}/env.sh`,
  ]);

  const [MAIN = "", BOXES = "", GH_REPO = "", COAUTHOR = "", HOME = "", TRACKER_HOME = ""] = out.split("\n");

  return { MAIN, BOXES, GH_REPO, COAUTHOR, HOME, TRACKER_HOME };
});

const lastLines = (output: string) => output.trimEnd().split("\n").slice(-30).join("\n");

/** One line in the quest's state file, the one the status page and the next agent read. */
const note = Effect.fnUntraced(function* (boxes: string, quest: string, line: string) {
  const fs = yield* FileSystem.FileSystem;
  const at = DateTime.formatIso(yield* DateTime.now);
  yield* fs.writeFileString(`${boxes}/state/${quest}.md`, `- ${at} ${line}\n`, { flag: "a" }).pipe(Effect.ignore);
});

/** The step that owns a path in the plan's files table: a row ending in / owns what is under it. */
const stepOwning = (owners: Readonly<Record<string, string>>, path: string): string => {
  const exact = owners[path];

  if (exact !== undefined) {
    return exact;
  }

  const under = Object.keys(owners)
    .filter((row) => row.endsWith("/") && path.startsWith(row))
    .toSorted((a, b) => b.length - a.length)[0];

  return under === undefined ? "no row in the plan" : (owners[under] ?? "no row in the plan");
};

const Owners = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

/** The plan's files table, or none when the quest has no plan that reads. */
const planOwners = Effect.fnUntraced(function* (main: string, plan: string | undefined) {
  if (plan === undefined) {
    return {};
  }

  const ran = yield* sh(main, "sh", [`${main}/.agents/skills/plan/scripts/plancheck.sh`, "--owners-json", plan]);

  return ran.code === 0 ? Schema.decodeUnknownOption(Owners)(ran.out).pipe(Option.getOrElse(() => ({}))) : {};
});

/** The PR body as it will be posted: the quest's body file, then the loosening check's output (the lead merges once every step passed, and waits on the owner only for real loosening or a new design call; mutation testing runs on a schedule against main, not in a pull request). */
const prBody = (body: string, loosening: string) => {
  const [first = "", ...rest] = body.split("\n");
  const fence = (t: string) => ["```text", t.trimEnd() || "(empty)", "```"];

  return {
    title: first.replace(/^#+\s*/, "").trim(),
    body: [rest.join("\n").trim(), "", "## Loosening", "", ...fence(loosening), ""].join("\n"),
  };
};

const ready = Command.make(
  "ready",
  {
    quest: Argument.String("quest"),
    tree: Flag.String("tree"),
    body: Flag.String("body").pipe(Flag.optional),
    loosening: Flag.String("loosening").pipe(Flag.optional),
    lead: Flag.String("lead").pipe(Flag.atLeast(0)),
    plan: Flag.String("plan").pipe(Flag.optional),
  },
  Effect.fn("land.ready")(function* (ask) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const env = yield* loadEnv;
    const tree = path.resolve(ask.tree);
    const branch = yield* must("ready", "the tree is on no branch", tree, "git", ["symbolic-ref", "--short", "HEAD"]);

    if (!branch.startsWith("fabrikalfa/")) {
      return yield* new Refused({ check: "ready", reason: `branch ${branch} is not fabrikalfa/<name>`, output: "" });
    }

    const dirty = yield* must("ready", "git status failed", tree, "git", ["status", "--porcelain"]);

    if (dirty !== "") {
      return yield* new Refused({ check: "ready", reason: "the tree has changes: commit them first", output: dirty });
    }

    const given = Option.all({ body: ask.body, loosening: ask.loosening });
    const some = [ask.body, ask.loosening].filter(Option.isSome).length;

    if (some !== 0 && Option.isNone(given)) {
      return yield* new Refused({
        check: "ready",
        reason: "give --body and --loosening together",
        output: "",
      });
    }

    const pr = Option.getOrUndefined(
      Option.map(given, (files) => ({
        body: path.resolve(files.body),
        loosening: path.resolve(files.loosening),
      })),
    );

    for (const [name, file] of Object.entries(pr ?? {})) {
      const read = yield* fs.readFileString(file).pipe(Effect.option);

      if (Option.isNone(read) || read.value.trim() === "") {
        return yield* new Refused({ check: "ready", reason: `--${name} ${file} is missing or empty`, output: "" });
      }
    }

    if (pr !== undefined && prBody(yield* fs.readFileString(pr.body), "").title === "") {
      return yield* new Refused({ check: "ready", reason: "the body file's first line is the PR title", output: "" });
    }

    // The body file is the pull request's description: a placeholder or a missing section is found here, before a push, not at the queue.
    const unwritten = pr === undefined ? null : Sections.refusal(prBody(yield* fs.readFileString(pr.body), "").body);

    if (unwritten !== null) {
      return yield* new Refused({ check: "ready", reason: `the body file: ${unwritten}`, output: "" });
    }

    const head = yield* must("ready", "HEAD does not read", tree, "git", ["rev-parse", "HEAD"]);
    const lead: string[] = [];

    for (const sha of ask.lead) {
      lead.push(yield* must("ready", `--lead ${sha} is not a commit`, tree, "git", ["rev-parse", `${sha}^{commit}`]));
    }

    const record = new Ready({
      quest: ask.quest,
      tree,
      branch,
      head,
      lead,
      pr,
      plan: Option.getOrUndefined(Option.map(ask.plan, (p) => path.resolve(p))),
      sentAt: DateTime.formatIso(yield* DateTime.now),
    });

    yield* fs.makeDirectory(`${env.BOXES}/state`, { recursive: true });
    yield* fs.writeFileString(`${env.BOXES}/state/${ask.quest}.land.json`, Schema.encodeSync(ReadyJson)(record));
    yield* note(
      env.BOXES,
      ask.quest,
      `quest agent: ready ${pr ? "to land" : "for the -wip push of"} ${branch} at ${head.slice(0, 8)}; the lead runs land.ts run`,
    );
    yield* Console.log(`ready to land: ${ask.quest} ${branch} at ${head.slice(0, 8)}`);
  }),
);

// The steps, one exported Effect each, so a flow (the lead drives work by writing a flow that one program runs, and no agent holds a loop, ticket 656) can run them one by one. Each
// takes the quest's facts and gives back what the next one needs; `run` below is a thin caller.

/** The quest as the lead lands it: what the quest agent recorded, the ticket, and env.sh's paths. */
export type Quest = {
  readonly quest: string;
  readonly ticket: string;
  readonly ready: Ready;
  readonly env: Effect.Success<typeof loadEnv>;
};

const gitIn =
  (tree: string) =>
  (check: typeof Check.Type, reason: string, ...args: ReadonlyArray<string>) =>
    must(check, reason, tree, "git", args);

/** Reads what the quest agent recorded with `land.ts ready`. */
export const readReady = Effect.fn("land.readReady")(function* (quest: string, ticket: string) {
  const fs = yield* FileSystem.FileSystem;
  const env = yield* loadEnv;

  const ready = yield* fs.readFileString(`${env.BOXES}/state/${quest}.land.json`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ReadyJson)),
    Effect.mapError(
      () =>
        new Refused({ check: "ready", reason: `no readable state/${quest}.land.json: run land.ts ready`, output: "" }),
    ),
  );

  return { quest, ticket, ready, env } satisfies Quest;
});

/** Refuses unless the tree is clean, on the ready branch and at the ready head. */
export const checkTree = Effect.fn("land.checkTree")(function* ({ ready }: Quest) {
  const git = gitIn(ready.tree);
  const on = yield* git("check", "the tree is on no branch", "symbolic-ref", "--short", "HEAD");
  const head = yield* git("check", "HEAD does not read", "rev-parse", "HEAD");
  const dirty = yield* git("check", "git status failed", "status", "--porcelain");

  if (on !== ready.branch || head !== ready.head) {
    return yield* new Refused({
      check: "check",
      reason: `the tree is at ${on} ${head.slice(0, 8)}, not the ready ${ready.branch} ${ready.head.slice(0, 8)}; run land.ts ready again`,
      output: "",
    });
  }

  if (dirty !== "") {
    return yield* new Refused({ check: "check", reason: "the tree has changes; nothing was done", output: dirty });
  }
});

/** Writes the PR body as it will be posted and leak-greps it; none for a mid-quest handover. */
export const draftPr = Effect.fn("land.draftPr")(function* ({ quest, ready, env }: Quest) {
  const fs = yield* FileSystem.FileSystem;

  if (ready.pr === undefined) {
    return undefined;
  }

  const posted = prBody(yield* fs.readFileString(ready.pr.body), yield* fs.readFileString(ready.pr.loosening));
  const unwritten = Sections.refusal(posted.body);

  if (unwritten !== null) {
    return yield* new Refused({ check: "ready", reason: `the PR body: ${unwritten}`, output: "" });
  }

  const file = `${env.BOXES}/${quest}-land-body.md`;
  yield* fs.writeFileString(file, posted.body);
  yield* must("leak", "the leak grep refused the PR body", ready.tree, "sh", [`${HERE}/leakgrep.sh`, "--text", file]);

  return { title: posted.title, file };
});

/** Origin's main as a commit (./pr/MainFetch.ts), a refusal at `check` when it cannot be read. */
const fetchedMain = (tree: string, check: typeof Check.Type) =>
  MainFetch.fetchedMain(tree).pipe(Effect.mapError((e) => new Refused({ check, reason: e.reason, output: e.output })));

/** Fetches main and merges it in as the bot, never a rebase; a conflict names each file's step. */
export const mergeMain = Effect.fn("land.mergeMain")(function* ({ ready, env }: Quest) {
  const main = yield* fetchedMain(ready.tree, "fetch");
  const behind = (yield* sh(ready.tree, "git", ["merge-base", "--is-ancestor", main, "HEAD"])).code !== 0;

  if (behind) {
    const merged = yield* sh(ready.tree, "git", [
      ...BOT,
      "merge",
      "-q",
      "--no-ff",
      "--no-edit",
      "-m",
      `Merge main into ${ready.branch}`,
      "-m",
      `Co-authored-by: ${env.COAUTHOR}`,
      main,
    ]);

    if (merged.code !== 0) {
      const conflicts = (yield* sh(ready.tree, "git", ["diff", "--name-only", "--diff-filter=U"])).out
        .split("\n")
        .filter((p) => p !== "");

      const owners = yield* planOwners(env.MAIN, ready.plan);

      return yield* new Refused({
        check: "merge",
        reason: [
          `merging main ${main.slice(0, 8)} conflicts in ${conflicts.length} files; nothing changed. Send each to the step that owns it:`,
          ...conflicts.map((p) => `  ${p}: ${stepOwning(owners, p)}`),
        ].join("\n"),
        output: `${merged.out}${merged.err}`,
      });
    }
  }

  return { main, merged: behind };
});

/** Leak-greps the branch's net change from main and each commit a push would send (the leak check reads each pushed commit on its own). */
export const leakCheck = Effect.fn("land.leakCheck")(function* ({ ready }: Quest, main: string) {
  const leakgrep = `${HERE}/leakgrep.sh`;

  const diff = yield* gitIn(ready.tree)(
    "leak",
    "the diff from main does not read",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--unified=0",
    `${main}...HEAD`,
  );

  yield* must("leak", "the leak grep refused the branch's change", ready.tree, "sh", [leakgrep], `${diff}\n`);
  yield* must("leak", "the leak grep refused a commit", ready.tree, "sh", [
    leakgrep,
    "--commits",
    "HEAD",
    "--not",
    "--remotes=origin",
  ]);
});

/**
 * Signs as lead through main's own signer, which alone reads the key: each named lead commit,
 * oldest first, each in the quest with one parent and no note yet, then the merge of main when there
 * is one. Gives back how many it signed.
 */
export const signLead = Effect.fn("land.signLead")(function* (
  { quest, ticket, ready, env }: Quest,
  main: string,
  merged: boolean,
) {
  const git = gitIn(ready.tree);

  const commits = (yield* git(
    "sign",
    "the quest's commits do not read",
    "rev-list",
    "--reverse",
    "--topo-order",
    `${main}..HEAD`,
  )).split("\n");

  const missing = ready.lead.filter((sha) => !commits.includes(sha));

  if (missing.length > 0) {
    return yield* new Refused({
      check: "sign",
      reason: `lead commits not on the quest: ${missing.join(" ")}`,
      output: "",
    });
  }

  const signer = `${env.MAIN}/next/apps/fabrika/src/exam/commits.ts`;
  const key = `${env.HOME}/.fabrika/step-keys/lead`;

  const sign = (at: string, subject: string) =>
    must("sign", `the sign script refused ${subject}`, at, "node", [
      signer,
      "sign",
      "--step",
      "lead",
      "--ticket",
      ticket,
      "--key",
      key,
    ]);

  for (const sha of commits.filter((c) => ready.lead.includes(c))) {
    const parents = (yield* git("sign", `${sha} does not read`, "rev-list", "--parents", "-n", "1", sha)).split(" ");
    const noted = yield* sh(ready.tree, "git", ["notes", "--ref=fabrika", "show", sha]);

    if (parents.length !== 2 || noted.code === 0) {
      return yield* new Refused({
        check: "sign",
        reason: `${sha} is a merge or already signed; name only unsigned lead commits`,
        output: "",
      });
    }

    // The signer signs HEAD, so each older commit gets a detached checkout of its own, given back after.
    const at = `${env.BOXES}/land-${quest}-${sha.slice(0, 8)}`;
    yield* Effect.acquireUseRelease(
      git("sign", `no checkout of ${sha}`, "worktree", "add", "-q", "--detach", at, sha),
      () => sign(at, `lead commit ${sha.slice(0, 8)}`),
      () => sh(ready.tree, "git", ["worktree", "remove", "--force", at]),
    );
  }

  if (merged) {
    yield* sign(ready.tree, "the merge of main");
  }

  return ready.lead.length + (merged ? 1 : 0);
});

/** Pushes with botpush.mjs: to the branch, or to its -wip backup for a mid-quest handover. */
export const push = Effect.fn("land.push")(function* ({ ready }: Quest) {
  const target = ready.pr === undefined ? `${ready.branch.replace(/(-wip)+$/, "")}-wip` : ready.branch;
  yield* must("push", `botpush.mjs to ${target} failed`, ready.tree, "node", [
    `${HERE}/botpush.mjs`,
    ready.tree,
    target,
    "HEAD",
  ]);

  return { target, tip: yield* gitIn(ready.tree)("push", "HEAD does not read", "rev-parse", "HEAD") };
});

/** Opens the PR, or updates the open one through the REST API (`gh pr edit` fails here, AGENTS.md). */
export const openPr = Effect.fn("land.openPr")(function* (
  { ready, env }: Quest,
  draft: { readonly title: string; readonly file: string },
) {
  const listed = yield* must("pr", "gh pr list failed", ready.tree, "gh", [
    "pr",
    "list",
    "-R",
    env.GH_REPO,
    "--head",
    ready.branch,
    "--state",
    "open",
    "--json",
    "number",
    "-q",
    ".[0].number",
  ]);

  const open = Number(listed);

  if (listed !== "" && Number.isInteger(open) && open > 0) {
    yield* must("pr", `PR ${open} could not be updated`, ready.tree, "gh", [
      "api",
      "-X",
      "PATCH",
      `repos/${env.GH_REPO}/pulls/${open}`,
      "-f",
      `title=${draft.title}`,
      "-F",
      `body=@${draft.file}`,
    ]);

    return open;
  }

  const made = yield* must("pr", "gh pr create failed", ready.tree, "gh", [
    "pr",
    "create",
    "-R",
    env.GH_REPO,
    "--head",
    ready.branch,
    "--title",
    draft.title,
    "--body-file",
    draft.file,
  ]);

  const number = Number(/\/pull\/(\d+)/.exec(made)?.[1]);

  if (!Number.isInteger(number)) {
    return yield* new Refused({ check: "pr", reason: "gh pr create named no PR", output: made });
  }

  return number;
});

type Env = Effect.Success<typeof loadEnv>;

/** The services the queue's two acts run on: GitHub through `gh`, the repo's own scripts, the tracker. */
const queueServices = (env: Env) =>
  Layer.mergeAll(
    PullRequestsGh.layer(env.GH_REPO, env.MAIN),
    PushesProcess.layer(HERE),
    ChecksGh.layer(env.GH_REPO),
    TicketsCli.layer(env.MAIN, env.TRACKER_HOME),
    SweepsProcess.layer(HERE),
    SignaturesGit.layer,
  );

/**
 * The line every merge path prints before its own, the one `check` prints: the merge gate passed it (./pr/Gate.ts). None for a
 * pull request found merged already, which no gate read. A path that got past the gate held an open pull request.
 */
const gateLines = (pr: number, merged: boolean): ReadonlyArray<string> =>
  merged ? [] : [Gate.line({ number: pr, state: "OPEN" })];

/**
 * Adds pull request `pr` to GitHub's merge queue (pr/Queue.ts): the leak checks, `ci-required`
 * green at its head, then one pinned squash. With `wait`, the check is given the quest's hour to end.
 * `dir` is the checkout the head is fetched into: the main checkout unless a quest names its tree.
 */
export const queue = Effect.fn("land.queue")(function* (
  env: Env,
  pr: number,
  wait: Queue.Wait | undefined,
  dir = env.MAIN,
) {
  return yield* Queue.add({ dir, pr, ...(wait ? { wait } : {}) }).pipe(
    Effect.provide(queueServices(env)),
    Effect.mapError(
      (e) => new Refused({ check: e._tag === "LeakGrepRefused" ? "leak" : "queue", reason: e.reason, output: "" }),
    ),
  );
});

/** Puts HEAD and the notes back as they were before the merge: the tree was clean, so nothing else is lost. */
const rollback = Effect.fn("land.rollback")(function* ({ ready }: Quest) {
  const notes = yield* sh(ready.tree, "git", ["rev-parse", "--verify", "-q", "refs/notes/fabrika"]);

  return Effect.gen(function* () {
    yield* sh(ready.tree, "git", ["merge", "--abort"]);
    yield* sh(ready.tree, "git", ["reset", "-q", "--hard", ready.head]);
    yield* sh(
      ready.tree,
      "git",
      notes.code === 0
        ? ["update-ref", "refs/notes/fabrika", notes.out.trim()]
        : ["update-ref", "-d", "refs/notes/fabrika"],
    );
  });
});

const run = Command.make(
  "run",
  { quest: Argument.String("quest"), ticket: Argument.String("ticket") },
  Effect.fn("land.run")(function* ({ quest: name, ticket }) {
    const quest = yield* readReady(name, ticket);
    const say = (line: string) => Effect.andThen(note(quest.env.BOXES, name, `land.ts: ${line}`), Console.log(line));
    yield* checkTree(quest);
    const draft = yield* draftPr(quest);
    const back = yield* rollback(quest);

    // Every refusal before the push changes nothing.
    const { main, signed, target, tip } = yield* Effect.gen(function* () {
      const { main, merged } = yield* mergeMain(quest);
      yield* leakCheck(quest, main);
      const signed = yield* signLead(quest, main, merged);

      return { main, signed, ...(yield* push(quest)) };
    }).pipe(Effect.onError(() => back));

    yield* say(`main at ${main.slice(0, 8)}, signed ${signed} lead commits, pushed ${target} at ${tip.slice(0, 8)}`);

    if (draft === undefined) {
      return;
    }

    const pr = yield* openPr(quest, draft);
    yield* say(
      `PR https://github.com/${quest.env.GH_REPO}/pull/${pr}; waiting for ${Queue.REQUIRED} to add it to the queue`,
    );
    const added = yield* queue(quest.env, pr, Queue.QUEST_WAIT, quest.ready.tree);

    for (const said of gateLines(pr, added._tag === "merged")) {
      yield* say(said);
    }

    yield* say(Queue.line(added));
  }),
);

const PrNumber = Argument.Int("pr");

/** The flags a wait takes: its limit in minutes and the seconds between two reads, each with the wait's default. */
const waitFlags = (fallback: Queue.Wait) => ({
  minutes: Flag.Int("wait-minutes").pipe(Flag.withDefault(fallback.minutes)),
  every: Flag.Int("every-seconds").pipe(Flag.withDefault(fallback.every)),
});

const queueCommand = Command.make(
  "queue",
  { pr: PrNumber, wait: Flag.Boolean("wait").pipe(Flag.withDefault(false)), ...waitFlags(Queue.QUEST_WAIT) },
  Effect.fn("land.queueCommand")(function* ({ pr, wait, minutes, every }) {
    const added = yield* queue(yield* loadEnv, pr, wait ? { minutes, every } : undefined);

    yield* Console.log(Arr.join([...gateLines(pr, added._tag === "merged"), Queue.line(added)], "\n"));
  }),
);

// The one wait for CI: reads `ci-required` at the pull request's head as it stands on each read (a push or an
// update-branch is followed), until it has ended, and says how. Exit 0 only on success. `queue --wait` and
// `admin --wait` make the same wait; no hand-written loop picks a workflow run instead.
const waitCommand = Command.make(
  "wait",
  { pr: PrNumber, ...waitFlags(Queue.QUEST_WAIT) },
  Effect.fn("land.waitCommand")(function* ({ pr, minutes, every }) {
    const env = yield* loadEnv;

    const at = yield* Queue.required("", { minutes, every }, pr).pipe(
      Effect.provide(queueServices(env)),
      Effect.mapError((e) =>
        e._tag === "Conflicting"
          ? new Refused({ check: "wait", reason: `pr ${pr}: ${Gate.conflictLine(pr)}`, output: "" })
          : e._tag === "Gone"
            ? new Refused({ check: "wait", reason: `pr ${pr}: it is ${e.state}, not open`, output: "" })
            : new Refused({ check: "wait", reason: e.reason, output: "" }),
      ),
    );

    const said = Queue.verdict(env.GH_REPO, pr, at);

    if (!said.ok) {
      return yield* new Refused({ check: "wait", reason: said.text, output: "" });
    }

    yield* Console.log(said.text);
  }),
);

/**
 * The commits on the branch since main (merges of main included, oldest first) that no tool vouches for: no note on
 * refs/notes/fabrika, no signature of a person's own, and not made by `stepcommit.sh` (a fix round's, which signs nothing, or a `--commit-only` commit, which `land.ts` signs later; its author is the bot's). A plain
 * `git commit` is the one that slips; CI never reads signatures on a PR branch, so the merge gate (pr/Gate.ts) is where it is found, on every path.
 * Fetches main and, when the head is not here, the head; changes nothing else. This is `Signatures.unsigned`, run on real git,
 * for `replay.ts`, whose child node runs it on a pull request's head.
 */
export const unsignedCommits = Effect.fn("land.unsignedCommits")(
  function* (tree: string, head: string) {
    return yield* (yield* Signatures).unsigned(tree, head);
  },
  Effect.provide(SignaturesGit.layer),
  Effect.mapError((e) => new Refused({ check: "check", reason: e.reason, output: "" })),
);

// The merge gate (pr/Gate.ts) alone: every check `queue` and the other merge paths run first, so a body and its commits are known good before
// the queue is asked. A lead runs it after writing a body and before `queue`; it asks GitHub for reads only and changes nothing.
const checkCommand = Command.make(
  "check",
  { pr: PrNumber },
  Effect.fn("land.checkCommand")(function* ({ pr }) {
    const env = yield* loadEnv;

    const checked = yield* Effect.gen(function* () {
      const found = yield* (yield* PullRequests).view(pr);

      return { found, refusal: yield* Gate.before({ dir: env.MAIN, found, marksReady: true }) };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PullRequestsGh.layer(env.GH_REPO, env.MAIN),
          PushesProcess.layer(HERE),
          TicketsCli.layer(env.MAIN, env.TRACKER_HOME),
          SignaturesGit.layer,
        ),
      ),
      Effect.mapError(
        (e) =>
          new Refused({
            check: e._tag === "LeakGrepRefused" ? "leak" : e._tag === "SignaturesError" ? "check" : "body",
            reason: e.reason,
            output: "",
          }),
      ),
    );

    if (checked.refusal !== null) {
      return yield* new Refused({ check: "body", reason: `pr ${pr}: ${checked.refusal}`, output: "" });
    }

    yield* Console.log(Gate.line(checked.found));
  }),
);

/** A refusal from a merge path: a leak grep that refused or could not run is the `leak` check's. */
const refusedAt =
  (check: typeof Check.Type) =>
  (e: { readonly reason: string }): Refused =>
    new Refused({ check: e instanceof LeakGrepRefused ? "leak" : check, reason: e.reason, output: "" });

const armCommand = Command.make(
  "arm",
  { pr: PrNumber },
  Effect.fn("land.armCommand")(function* ({ pr }) {
    const env = yield* loadEnv;

    const armed = yield* Arm.arm({ repo: env.GH_REPO, dir: env.MAIN, pr }).pipe(
      Effect.provide(
        Layer.mergeAll(
          PullRequestsGh.layer(env.GH_REPO, env.MAIN),
          PushesProcess.layer(HERE),
          RunsGh.layer(env.GH_REPO, env.MAIN),
          ChecksGh.layer(env.GH_REPO),
          TicketsCli.layer(env.MAIN, env.TRACKER_HOME),
          SignaturesGit.layer,
        ),
      ),
      Effect.mapError(refusedAt("arm")),
    );

    yield* Console.log(Arr.join([...gateLines(pr, armed._tag === "merged"), Arm.line(armed)], "\n"));
  }),
);

/** The admin route the sev log gives, read in the main checkout (Level.routeFromLog builds it, a sev fix is admin-merged one at a time on current main). */
const adminRoute = Effect.fn("land.adminRoute")(function* (env: Env) {
  const unread = (reason: string) => new Refused({ check: "merge", reason, output: "" });

  const { entries, sev0 } = yield* Level.read(`${env.MAIN}/runs/sev`).pipe(
    Effect.mapError((e) => unread(`the sev log does not read: ${e._tag === "Refused" ? e.reason : e.message}`)),
  );

  // The issues are read only when a sev1 fix could be named: no open sev0, and a fix line in the log.
  const mayName = sev0._tag === "closed" && entries.some(Level.Entry.guards.fix);

  const issues: Result.Result<ReadonlyArray<Level.Alert>, string> = mayName
    ? yield* Effect.gen(function* () {
        return yield* (yield* Alerts).open;
      }).pipe(
        Effect.provide(AlertsGh.layer(env.GH_REPO, env.MAIN)),
        Effect.mapError((e) => e.reason),
        Effect.result,
      )
    : Result.succeed([]);

  if (Result.isFailure(issues)) {
    yield* Console.log(`land: the open ci-scheduled issues do not read (${issues.failure}), so no sev1 fix is named`);
  }

  return Merge.Route.cases.admin.make(Level.routeFromLog(entries, sev0, issues));
});

/** One merge by hand (pr/Merge.ts) on this route, with this wait for an admin merge; prints what it did. */
const mergeBy = Effect.fn("land.mergeBy")(function* (
  env: Env,
  pr: number,
  route: Merge.Route,
  wait?: Queue.Wait,
  queueWait?: Queue.Wait,
) {
  const done = yield* Merge.merge({
    dir: env.MAIN,
    pr,
    route,
    ...(wait ? { wait } : {}),
    ...(queueWait ? { queueWait } : {}),
  }).pipe(
    Effect.provide(Layer.merge(queueServices(env), BranchesGit.layer(env.MAIN))),
    Effect.mapError(refusedAt("merge")),
  );

  yield* Console.log(Arr.join([...gateLines(pr, done._tag === "merged"), Merge.line(done)], "\n"));
});

const mergeCommand = Command.make(
  "merge",
  { pr: PrNumber, admin: Flag.Boolean("admin") },
  Effect.fn("land.mergeCommand")(function* ({ pr, admin }) {
    const env = yield* loadEnv;

    yield* mergeBy(env, pr, admin ? yield* adminRoute(env) : Merge.Route.cases.queue.make({}));
  }),
);

// The one way the lead admin merges: marks a draft ready, waits for ci-required, merges, then reads the pull request once more.
const adminCommand = Command.make(
  "admin",
  {
    pr: PrNumber,
    ...waitFlags(Merge.ADMIN_WAIT),
    wait: Flag.Boolean("wait"),
    queueMinutes: Flag.Int("queue-minutes").pipe(Flag.withDefault(Queue.QUEST_WAIT.minutes)),
    queueEvery: Flag.Int("queue-every-seconds").pipe(Flag.withDefault(Queue.QUEST_WAIT.every)),
  },
  Effect.fn("land.adminCommand")(function* ({ pr, minutes, every, wait, queueMinutes, queueEvery }) {
    const env = yield* loadEnv;

    yield* mergeBy(
      env,
      pr,
      yield* adminRoute(env),
      { minutes, every },
      wait ? { minutes: queueMinutes, every: queueEvery } : undefined,
    );

    // The merge happened, so this read only reports: a read that fails says so and the command still succeeds.
    const found = yield* Effect.gen(function* () {
      return yield* (yield* PullRequests).view(pr);
    }).pipe(Effect.provide(PullRequestsGh.layer(env.GH_REPO, env.MAIN)), Effect.result);

    yield* Console.log(
      Result.isSuccess(found)
        ? `pr ${pr}: ${found.success.state}, merge commit ${found.success.mergeCommit ?? "none yet"}`
        : `pr ${pr}: merged, but its state could not be read afterward (${found.failure.reason})`,
    );
  }),
);

const merged = Command.make(
  "merged",
  { prs: PrNumber.pipe(Argument.atLeast(1)) },
  Effect.fn("land.merged")(function* ({ prs }) {
    const env = yield* loadEnv;

    for (const pr of prs) {
      const settled = yield* Queue.settle({ repo: env.GH_REPO, pr }).pipe(
        Effect.provide(queueServices(env)),
        Effect.mapError((e) => new Refused({ check: "queue", reason: e.reason, output: "" })),
      );

      yield* Console.log(settled.lines.join("\n"));
    }
  }),
);

const closeNamed = Command.make(
  "close-named",
  { prs: PrNumber.pipe(Argument.atLeast(1)) },
  Effect.fn("land.closeNamed")(function* ({ prs }) {
    const env = yield* loadEnv;

    for (const pr of prs) {
      const settled = yield* Queue.closeOnly({ repo: env.GH_REPO, pr }).pipe(
        Effect.provide(queueServices(env)),
        Effect.mapError((e) => new Refused({ check: "queue", reason: e.reason, output: "" })),
      );

      yield* Console.log(settled.lines.join("\n"));
    }
  }),
);

const land = Command.make("land").pipe(
  Command.withSubcommands([
    ready,
    run,
    queueCommand,
    waitCommand,
    checkCommand,
    armCommand,
    mergeCommand,
    adminCommand,
    merged,
    closeNamed,
  ]),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(land, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError((e) =>
        e instanceof Refused
          ? Console.error(
              [lastLines(e.output), `land: refused at the ${e.check} check: ${e.reason}`].filter(Boolean).join("\n"),
            )
          : Effect.void,
      ),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
