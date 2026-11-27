import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Sections from "./pr/Sections.ts";

// Today's tooling (ticket 652). Git and the leak grep are real, on disposable repos. The signer,
// botpush and gh are stubs that say what they were asked. The stub signer adds a real
// note to HEAD, so a rollback can be seen in refs/notes/fabrika.
const script = join(import.meta.dirname, "land.ts");

const planted = "plantedleakword652";

/** A description as the pr skill's template writes it, with `\n` as the stub's JSON carries it. */
const full = "## Summary\\n\\nWhat it does.\\n\\n## Evidence\\n\\nA test.\\n\\n## Merge Danger\\n\\n**Door:** two-way";

const node = `#!/bin/sh
case "$1" in
*botpush.mjs)
  echo "push $3 $4" >>"$LAND_CALLS"
  # The fixture's origin takes the push, as GitHub would, so the queue step can fetch the head.
  git -C "$2" push -q origin "$4:refs/heads/$3" ;;
*commits.ts)
  echo "sign $(git rev-parse HEAD) $*" >>"$LAND_CALLS"
  [ "\${LAND_SIGN:-0}" = 0 ] || exit 1
  # A note is written by someone: name the fixture, as the real signer's caller has an identity.
  git -c user.name=Fixture -c user.email=fixture@example.test notes --ref=fabrika add -f -m '{"step":"lead"}' HEAD ;;
*cli.ts)
  # The tracker's list, one line for each open ticket in LAND_TICKETS.
  for n in $LAND_TICKETS; do echo "agent:lead: #$n open a ticket"; done ;;
*) echo "unexpected node $*" >>"$LAND_CALLS"; exit 99 ;;
esac
`;

// GitHub as the queue step reads it: the pull request at the quest's pushed head, ready and into
// main, and \`ci-required\` at that head as LAND_REQUIRED says (success unless a law sets it).
const gh = `#!/bin/sh
echo "gh $*" >>"$LAND_CALLS"
head=$(git -C "$LAND_QUEST" rev-parse HEAD)
case "$1 $2" in
"pr list") echo "\${LAND_OPEN:-}" ;;
"pr create") echo "https://github.com/owner/repo/pull/77" ;;
"pr view")
  # A draft stays one until the call to mark it ready has been made.
  draft=false
  [ "\${LAND_DRAFT:-}" = 1 ] && ! grep -q "^gh pr ready" "$LAND_CALLS" && draft=true
  # \`LAND_MERGEABLE=later\` is a pull request that conflicts with main from the second read on.
  mergeable=\${LAND_MERGEABLE:-MERGEABLE}
  [ "$mergeable" != later ] || { [ "$(grep -c "^gh pr view" "$LAND_CALLS")" -lt 2 ] && mergeable=MERGEABLE || mergeable=CONFLICTING; }
  printf '{"number":%s,"headRefName":"fabrikalfa/t652-fixture","headRefOid":"%s","baseRefName":"main","state":"%s","isDraft":%s,"title":"%s","body":"%s","mergeCommit":null,"mergeable":"%s"}\\n' "$3" "$head" "\${LAND_STATE:-OPEN}" "$draft" "\${LAND_TITLE:-T652 fixture: one quest}" "\${LAND_BODY:-}" "$mergeable" ;;
"api graphql") echo '{"data":{"repository":{"mergeQueue":null}}}' ;;
"api --paginate")
  # A head's commit statuses, as the slice-2 review check reads them: \`--slurp\` and the commits endpoint.
  if [ "$3" = --slurp ]; then
    sha=\${4#*commits/}
    sha=\${sha%%/*}
    printf '[['
    [ ! -f "$LAND_STATUSES/$sha" ] || paste -sd, - <"$LAND_STATUSES/$sha" | tr -d '\\n'
    printf ']]\\n'
    exit 0
  fi
  # The open GitHub issues, one number a line, when it is the issues list that is asked for.
  case "$3" in */issues?*) for n in $LAND_ISSUES; do echo "$n"; done; exit 0 ;; esac
  # The files the pull request changes, one JSON row each: one new export when a law names one.
  [ -z "\${LAND_PATCH:-}" ] || printf '{"path":"src/thing.ts","patch":"@@ -0,0 +1 @@\\\\n+export const %s = 1"}\\n' "$LAND_PATCH" ;;
"api -X")
  case "$3 $4" in
  # The review record's two writes (a pull request comment, a commit status), kept as the status check reads them back.
  "POST "*/comments) echo '{"id":1,"html_url":"https://github.com/owner/repo/pull/77#issuecomment-1"}' ;;
  "POST "*/statuses/*)
    sha=\${4##*/}
    shift 4
    state=; description=; url=
    while [ $# -gt 0 ]; do
      case "$2" in
      state=*) state=\${2#state=} ;;
      description=*) description=\${2#description=} ;;
      target_url=*) url=\${2#target_url=} ;;
      esac
      shift 2
    done
    n=$(( $(cat "$LAND_STATUSES/count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" >"$LAND_STATUSES/count"
    echo "{\\"id\\":$n,\\"state\\":\\"$state\\",\\"context\\":\\"review\\",\\"description\\":\\"$description\\",\\"target_url\\":\\"$url\\",\\"creator\\":{\\"login\\":\\"fixture\\"}}" >>"$LAND_STATUSES/$sha"
    echo '{}' ;;
  # A read of a workflow's runs: none, so a pull request arms as one with no run at its head.
  *) [ "$3" != GET ] || echo '{"workflow_runs":[]}' ;;
  esac ;;
"api -i")
  # \`LAND_REQUIRED=pending\` is a check that has not ended.
  status=completed
  conclusion="\${LAND_REQUIRED:-success}"
  [ "$conclusion" != pending ] || { status=in_progress; conclusion=null; }
  [ "$conclusion" = null ] || conclusion="\\"$conclusion\\""
  printf 'HTTP/2.0 200 OK\\n\\r\\n{"check_runs":[{"id":1,"status":"%s","conclusion":%s,"app":{"slug":"github-actions"}}]}' "$status" "$conclusion" ;;
esac
`;

const plancheck = `#!/bin/sh
echo '{"quest.txt": "build", "next/": "tests"}'
`;

type World = {
  /** Main moved after the quest left it, in a file of its own. */
  readonly behind: boolean;
  /** Main moved in the quest's own file, so merging it conflicts. */
  readonly conflict: boolean;
  /** The tree holds a change nobody committed when the lead runs. */
  readonly dirty: boolean;
  /** A quest commit adds a private word. */
  readonly leak: boolean;
  /** The sign script refuses. */
  readonly signFails: boolean;
  /** The quest agent made a lead commit of its own and names it. */
  readonly leadCommit: boolean;
  readonly open?: string;
  readonly wip?: boolean;
  /** `ci-required` failed at the pushed head. */
  readonly red?: boolean;
  /** The pull request is a draft until it is marked ready. */
  readonly draft?: boolean;
  /** The pull request's state at GitHub; open when left out. */
  readonly state?: "OPEN" | "CLOSED";
  /** How the pull request stands with main: `later` is clear on the first read and conflicting from the second. */
  readonly mergeable?: "MERGEABLE" | "CONFLICTING" | "later";
  /** `ci-required` has not ended at the pushed head. */
  readonly pending?: boolean;
  /** The quest's body file as `ready` reads it, first line the title; a full template body when left out. */
  readonly readyBody?: string;
  /** The body file changes to this text after `ready` took it and before the command runs. */
  readonly laterBody?: string;
  /** `ready` refuses the body file: the run stops there, before anything is pushed. */
  readonly readyRefused?: boolean;
  /** The pull request's description, with `\n` for a new line; a full template body when left out. */
  readonly body?: string;
  /** The pull request's title; the quest's own when left out. */
  readonly title?: string;
  /** The tracker's open tickets, and GitHub's open issues, as space-separated numbers. */
  readonly tickets?: string;
  readonly issues?: string;
  /** The quest also changes a file under `next/`, a path that needs a review (slice 2 of .kalfa/quests/review-record-PLAN.md). */
  readonly reviewedPath?: boolean;
  /** The one new export the pull request's diff adds, in `src/thing.ts`; none when left out. */
  readonly patch?: string;
  /** Run this command after `land.ts`, in place of `run <quest> <ticket>`; the main checkout is then the quest's tree. */
  readonly command?: ReadonlyArray<string>;
  /** The ready record names the quest `lane`, as one written before the rule that a lane is called a quest does. */
  readonly laneKey?: boolean;
  /** The branch holds one more commit with no note, as a plain `git commit --allow-empty` makes. */
  readonly unsignedCommit?: boolean;
  /** The branch holds commits as `stepcommit.sh` makes them (its bot identity), with no note: a fix round's, and a `--commit-only` lead commit's, with files and with none. */
  readonly toolCommits?: boolean;
  /** The checkout's FETCH_HEAD holds what another session's fetch left there, which a run must neither read nor write. */
  readonly strangerFetch?: boolean;
  /** This many more copies of `command` run in the same checkout at the same moment, before the one this helper answers for. */
  readonly alongside?: number;
  /** Settings the command's environment carries, such as `LAND_LOG_MINUTES`. */
  readonly settings?: Readonly<Record<string, string>>;
  /** `runs` in the main checkout is a file, so no record can be made under `runs/land`. */
  readonly blockRecord?: boolean;
  /** The final command's boxes folder is under a plain file, so `ready` cannot make `state` there: a failure that is no refusal. */
  readonly boxesUnderFile?: boolean;
  /** A second command, run right after `command` in the same checkout: it reads what the first left. */
  readonly afterwards?: ReadonlyArray<string>;
};

/** The fields of a record line that a law here reads. The record's own schema is the product's; a law at the command line reads the file as a person would. */
const Row = Schema.Struct({
  _tag: Schema.String,
  attempt: Schema.String,
  command: Schema.optional(Schema.String),
  argv: Schema.optional(Schema.Array(Schema.String)),
  check: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  said: Schema.optional(Schema.Array(Schema.String)),
});

type Row = typeof Row.Type;

const RowLine = Schema.fromJsonString(Row);

/** The lines `land.ts` left in `runs/land` of the main checkout, one list for each file. */
const recordsIn = (main: string): Record<string, ReadonlyArray<Row>> => {
  const folder = join(main, "runs/land");

  return existsSync(folder) && readdirSync(folder).length > 0
    ? Object.fromEntries(
        readdirSync(folder).map((name) => [
          name,
          readFileSync(join(folder, name), "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => Schema.decodeUnknownSync(RowLine)(line)),
        ]),
      )
    : {};
};

const land = (world: World) => {
  const dir = mkdtempSync(join(tmpdir(), "land-"));
  const main = join(dir, world.command ? "quest" : "main");

  try {
    const env = {
      ...process.env,
      PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      // As on a CI machine (PR 816): git has no identity to guess from this machine's user or
      // host, and none from the caller's environment, so every git call that writes one names it.
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.useConfigOnly",
      GIT_CONFIG_VALUE_0: "true",
      GIT_AUTHOR_NAME: undefined,
      GIT_AUTHOR_EMAIL: undefined,
      GIT_COMMITTER_NAME: undefined,
      GIT_COMMITTER_EMAIL: undefined,
      EMAIL: undefined,
      MAIN: main,
      LAND_DRAFT: world.draft ? "1" : "",
      LAND_STATE: world.state ?? "OPEN",
      LAND_MERGEABLE: world.mergeable ?? "MERGEABLE",
      LAND_BODY: world.body ?? full,
      LAND_TITLE: world.title ?? "T652 fixture: one quest",
      LAND_PATCH: world.patch ?? "",
      LAND_STATUSES: join(dir, "statuses"),
      LAND_TICKETS: world.tickets ?? "",
      LAND_ISSUES: world.issues ?? "",
      BOXES: join(dir, "boxes"),
      REMOTE: join(dir, "origin"),
      GH_REPO: "owner/repo",
      FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
      FABRIKA_LEAK_WORDS: join(dir, "words"),
      LAND_CALLS: join(dir, "calls"),
      LAND_SIGN: world.signFails ? "1" : "0",
      LAND_OPEN: world.open ?? "",
      LAND_QUEST: join(dir, "quest"),
      LAND_REQUIRED: world.red ? "failure" : world.pending ? "pending" : "success",
      TYPESAFE_API_KEY: undefined,
    };

    const git = (at: string, ...args: string[]) => {
      const got = spawnSync(
        "/usr/bin/git",
        ["-C", at, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
        { encoding: "utf8", env, timeout: 10_000 },
      );

      expect(got.status, got.stderr).toBe(0);

      return got.stdout.trim();
    };

    const script_ = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { cwd: quest, encoding: "utf8", env, timeout: 60_000 });

    const origin = join(dir, "origin");
    const quest = join(dir, "quest");

    for (const folder of ["bin", "home", "origin", "boxes", "statuses", "main/.agents/skills/plan/scripts"]) {
      mkdirSync(join(dir, folder), { recursive: true });
    }

    writeFileSync(join(dir, "bin/node"), node, { mode: 0o755 });
    writeFileSync(join(dir, "bin/gh"), gh, { mode: 0o755 });
    writeFileSync(join(dir, "main/.agents/skills/plan/scripts/plancheck.sh"), plancheck, { mode: 0o755 });
    writeFileSync(join(dir, "words"), `${planted}\n`);
    git(origin, "init", "-q", "--initial-branch=main");
    writeFileSync(join(origin, "quest.txt"), "base\n");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "base");
    // GitHub serves a commit by its sha; a plain repo does only when told to.
    git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
    git(dir, "clone", "-q", origin, quest);
    // As in the real checkout, where git ignores `runs/`: a command's record is no change to the tree.
    appendFileSync(join(quest, ".git/info/exclude"), "runs\n");

    if (world.blockRecord) {
      writeFileSync(join(main, "runs"), "a file, not a folder");
    }

    git(quest, "checkout", "-q", "-b", "fabrikalfa/t652-fixture");
    writeFileSync(join(quest, "quest.txt"), world.leak ? `the quest, with ${planted}\n` : "the quest\n");

    if (world.reviewedPath) {
      mkdirSync(join(quest, "next"), { recursive: true });
      writeFileSync(join(quest, "next/thing.ts"), "export const thing = 1;\n");
    }

    git(quest, "add", ".");
    git(quest, "commit", "-qm", "the quest's step");
    git(quest, "notes", "--ref=fabrika", "add", "-m", '{"step":"build"}', "HEAD");
    const lead: string[] = [];

    if (world.leadCommit) {
      writeFileSync(join(quest, "rows.jsonl"), '{"row":1}\n');
      git(quest, "add", ".");
      git(quest, "commit", "-qm", "the quest's field rows, unsigned");
      lead.push("--lead", git(quest, "rev-parse", "HEAD"));
    }

    for (const [name, text] of [
      [
        "body.md",
        world.readyBody ??
          "T652 fixture: one quest\n\n### Summary\n\nWhat the quest did.\n\n### Evidence\n\nA test.\n\n### Merge Danger\n\n**Door:** two-way\n\nfabrika close ticket 652\n",
      ],
      ["loosening.out", "loosening: 0 hits\n"],
    ] as const) {
      writeFileSync(join(dir, name), text);
    }

    const said = script_(
      "ready",
      "t652f",
      "--tree",
      quest,
      // A mid-quest handover names no PR files.
      ...(world.wip ? [] : ["--body", join(dir, "body.md"), "--loosening", join(dir, "loosening.out")]),
      "--plan",
      join(dir, "plan.md"),
      ...lead,
    );

    if (world.readyRefused) {
      const beside: Array<{ code: string; err: string }> = [];

      return {
        code: said.status,
        err: said.stderr,
        out: said.stdout,
        calls: existsSync(env.LAND_CALLS) ? readFileSync(env.LAND_CALLS, "utf8").trim().split("\n") : [],
        before: [git(quest, "rev-parse", "HEAD")],
        after: [git(quest, "rev-parse", "HEAD")],
        parents: 0,
        subject: "",
        status: git(quest, "status", "--porcelain"),
        strangerKept: true,
        refsLeft: "",
        beside,
        lead: lead[1],
        leadNoted: false,
        state: "",
        head: git(quest, "rev-parse", "HEAD"),
        recorded: existsSync(join(dir, "boxes/state/t652f.land.json")),
        landed: recordsIn(main),
        next: undefined,
      };
    }

    expect(said.status, said.stderr).toBe(0);

    if (world.laterBody !== undefined) {
      writeFileSync(join(dir, "body.md"), world.laterBody);
    }

    const record = join(dir, "boxes/state/t652f.land.json");
    // SAFETY: land.ts writes this file with ReadyJson, a JSON object, so it parses to a record.
    const { quest: named, ...rest } = JSON.parse(readFileSync(record, "utf8")) as Record<string, unknown>;
    expect(named).toBe("t652f");

    if (world.laneKey) {
      writeFileSync(record, JSON.stringify({ lane: named, ...rest }));
    }

    if (world.behind) {
      writeFileSync(join(origin, "other.txt"), "main moved\n");
    }

    if (world.conflict) {
      writeFileSync(join(origin, "quest.txt"), "main, in the quest's file\n");
    }

    if (world.behind || world.conflict) {
      git(origin, "add", ".");
      git(origin, "commit", "-qm", "main moved");
    }

    if (world.dirty) {
      writeFileSync(join(quest, "quest.txt"), "an edit nobody committed\n");
    }

    if (world.unsignedCommit) {
      git(quest, "commit", "-q", "--allow-empty", "-m", "open the slice");
    }

    if (world.toolCommits) {
      const bot = [
        "-c",
        "user.name=fabrikalfa[bot]",
        "-c",
        "user.email=353269643+fabrikalfa[bot]@users.noreply.github.com",
      ];

      writeFileSync(join(quest, "fix.txt"), "a fix round\n");
      git(quest, "add", "fix.txt");
      git(quest, ...bot, "commit", "-q", "-m", "T652 fix: a fix round signs nothing");
      writeFileSync(join(quest, "row.txt"), "a plan row\n");
      git(quest, "add", "row.txt");
      git(quest, ...bot, "commit", "-q", "-m", "T652 lead: approve the plan");
      git(quest, ...bot, "commit", "-q", "--allow-empty", "-m", "T652 lead: begin the slice");
    }

    const strangerFetch = `${"0".repeat(40)}\t\tbranch 'other' of elsewhere\n`;

    if (world.strangerFetch) {
      writeFileSync(join(quest, ".git/FETCH_HEAD"), strangerFetch);
    }

    const alongside = world.alongside ?? 0;

    if (alongside > 0) {
      spawnSync(
        "sh",
        [
          "-c",
          `for i in $(seq ${alongside}); do ("$0" "$1" ${(world.command ?? []).join(" ")} >"${dir}/side$i.out" 2>"${dir}/side$i.err"; echo $? >"${dir}/side$i.code") & done; wait`,
          process.execPath,
          script,
        ],
        { cwd: quest, env, timeout: 60_000 },
      );
    }

    const before = [git(quest, "rev-parse", "HEAD"), git(quest, "rev-parse", "refs/notes/fabrika")];

    if (world.boxesUnderFile) {
      writeFileSync(join(dir, "plain"), "a file, not a folder");
    }

    // `{tree}` in an argument is the quest's checkout, and `{head}` the head the quest agent leaves it at (the head its review reads).
    const args = (world.command ?? ["run", "t652f", "652"]).map((arg) =>
      arg.replace("{tree}", quest).replace("{head}", before[0] ?? ""),
    );

    const ran = spawnSync(process.execPath, [script, ...args], {
      cwd: quest,
      encoding: "utf8",
      env: {
        ...env,
        ...(world.boxesUnderFile ? { BOXES: join(dir, "plain", "boxes") } : {}),
        ...world.settings,
      },
      timeout: 60_000,
    });

    expect(ran.error).toBeUndefined();

    const next =
      world.afterwards === undefined
        ? undefined
        : spawnSync(process.execPath, [script, ...world.afterwards], {
            cwd: quest,
            encoding: "utf8",
            env,
            timeout: 60_000,
          });

    const calls = existsSync(env.LAND_CALLS) ? readFileSync(env.LAND_CALLS, "utf8").trim().split("\n") : [];
    const head = git(quest, "rev-parse", "HEAD");

    return {
      code: ran.status,
      err: ran.stderr,
      out: ran.stdout,
      calls,
      before,
      after: [head, git(quest, "rev-parse", "refs/notes/fabrika")],
      parents: git(quest, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length - 1,
      subject: git(quest, "log", "-1", "--format=%s"),
      status: git(quest, "status", "--porcelain"),
      // What a run left of the stranger's FETCH_HEAD, and of any ref it made.
      strangerKept: !world.strangerFetch || readFileSync(join(quest, ".git/FETCH_HEAD"), "utf8") === strangerFetch,
      refsLeft: git(quest, "for-each-ref", "refs/land-fetch"),
      // The copies that ran beside it: each one's exit code and what it said.
      beside: Array.from({ length: alongside }, (_, i) => ({
        code: readFileSync(join(dir, `side${i + 1}.code`), "utf8").trim(),
        err: readFileSync(join(dir, `side${i + 1}.err`), "utf8"),
      })),
      lead: lead[1],
      // The quest's own lead commit carries a note once the run is over.
      leadNoted:
        lead[1] !== undefined &&
        spawnSync("/usr/bin/git", ["-C", quest, "notes", "--ref=fabrika", "show", lead[1]], { env }).status === 0,
      state: readFileSync(join(dir, "boxes/state/t652f.md"), "utf8"),
      head,
      recorded: true,
      landed: recordsIn(main),
      // What the second command said, when there is one.
      next: next === undefined ? undefined : { code: next.status, out: next.stdout, err: next.stderr },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const fine: World = { behind: false, conflict: false, dirty: false, leak: false, signFails: false, leadCommit: false };

describe("land.ts, today's tooling", () => {
  // Each run builds a git origin and a clone and runs the script, 1.2 s, so the 10 runs took 12 s here and 26 s of CI's 60 s limit as one law. They are two
  // laws by whether the tree is dirty, 5 runs each: the 10 runs the one law drew, and each is half the work.
  for (const dirtyTree of [false, true]) {
    it(`T652 property: a quest lands only with no fault, and a refused run changes nothing and pushes nothing, with${dirtyTree ? "" : "out"} a dirty tree`, () => {
      fc.assert(
        fc.property(
          fc.record({
            behind: fc.boolean(),
            conflict: fc.boolean(),
            dirty: fc.constant(dirtyTree),
            leak: fc.boolean(),
            signFails: fc.boolean(),
            leadCommit: fc.boolean(),
          }),
          (world) => {
            const got = land(world);
            // Signing is reached only when there is something to sign.
            const signs = world.behind || world.conflict || world.leadCommit;
            const faulted = world.dirty || world.conflict || world.leak || (world.signFails && signs);

            const sent = got.calls.filter((c) => /^(push|gh)/.test(c));
            expect(got.code === 0, got.err).toBe(!faulted);
            // A refused run leaves HEAD and the notes as they were, and sends nothing anywhere.
            expect(faulted ? got.after : got.before).toEqual(got.before);
            expect(faulted ? sent : []).toEqual([]);
            // A clean one ends in the one pinned squash that adds it to the queue.
            const queued = `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`;
            expect(faulted ? queued : got.calls.at(-1)).toBe(queued);
            expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(faulted ? 0 : 1);
          },
        ),
        { seed: 652, numRuns: 5 },
      );
    }, 300_000);
  }

  it("T652 scenario: behind main with no conflict lands, the merge and the quest's own lead commit signed, oldest first", () => {
    const got = land({ ...fine, behind: true, leadCommit: true });
    expect(got.code, got.err).toBe(0);
    expect(got.parents).toBe(2);
    expect(got.subject).toBe("Merge main into fabrikalfa/t652-fixture");
    const signs = got.calls.filter((c) => c.startsWith("sign "));
    expect(signs.map((c) => c.split(" ")[1])).toEqual([got.lead, got.head]);
    expect(signs.every((c) => c.includes("--step lead --ticket 652 --key ") && c.includes("/main/next/"))).toBe(true);
    expect(got.leadNoted).toBe(true);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual([
      "push fabrikalfa/t652-fixture HEAD",
      "gh pr list -R owner/repo --head fabrikalfa/t652-fixture --state open --json number -q .[0].number",
      expect.stringMatching(
        /^gh pr create -R owner\/repo --head fabrikalfa\/t652-fixture --title T652 fixture: one quest --body-file /,
      ),
      "gh pr view 77 -R owner/repo --json number,headRefName,headRefOid,state,isDraft,baseRefName,title,body,mergeCommit,mergeable",
      // The names check (a new helper names the tools it searched, and a new name cites the industry's word) reads the diff after the leak grep and before `ci-required`.
      "gh api --paginate repos/owner/repo/pulls/77/files --jq .[] | {path: .filename, patch: (.patch // null)}",
      // The quest's wait reads the head, the check at it, and the head again once the check has ended.
      "gh pr view 77 -R owner/repo --json number,headRefName,headRefOid,state,isDraft,baseRefName,title,body,mergeCommit,mergeable",
      expect.stringMatching(
        /^gh api -i repos\/owner\/repo\/commits\/[0-9a-f]{40}\/check-runs .*check_name=ci-required/,
      ),
      "gh pr view 77 -R owner/repo --json number,headRefName,headRefOid,state,isDraft,baseRefName,title,body,mergeCommit,mergeable",
      `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`,
    ]);
    expect(got.state).toContain("quest agent: ready to land");
    // It says queued, never merged or landed: GitHub's queue merges it later.
    expect(got.state).toContain(`land.ts: pr 77: queued at ${got.head}`);
    expect(got.state).not.toMatch(/landed|merged PR/);
  });

  // Plant: read only `quest`, so a quest made ready before the rule that a lane is called a quest cannot land.
  it("scenario: a ready record that names the quest `lane`, written before the rule that a lane is called a quest, lands as a new one does", () => {
    const got = land({ ...fine, laneKey: true });
    expect(got.code, got.err).toBe(0);
    expect(got.calls.at(-1)).toBe(`gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`);
  });

  it("T652 scenario: a conflict with main stops, names each file and its owning step, and leaves the tree as it was", () => {
    const got = land({ ...fine, conflict: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the merge check");
    expect(got.err).toContain("  quest.txt: build");
    expect(got.after).toEqual(got.before);
    expect(got.status).toBe("");
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: a dirty tree refuses before anything runs, and the edit stays", () => {
    const got = land({ ...fine, behind: true, dirty: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the check check: the tree has changes");
    expect(got.status).toBe("M quest.txt");
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: a leak grep hit in a quest commit fails closed, the merge undone, nothing signed or pushed", () => {
    const got = land({ ...fine, behind: true, leak: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the leak check");
    expect(got.err).not.toContain(planted);
    expect(got.after).toEqual(got.before);
    expect(got.calls).toEqual([]);
  });

  it("T652 scenario: the sign script failing refuses, and the merge and its notes are undone", () => {
    const got = land({ ...fine, behind: true, signFails: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the sign check: the sign script refused the merge of main");
    expect(got.after).toEqual(got.before);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual([]);
  });

  it("T652 scenario: an open PR is updated through the REST API, never gh pr edit", () => {
    const got = land({ ...fine, open: "41" });
    expect(got.code, got.err).toBe(0);
    expect(got.calls).toContainEqual(
      expect.stringMatching(
        /^gh api -X PATCH repos\/owner\/repo\/pulls\/41 -f title=T652 fixture: one quest -F body=@/,
      ),
    );
    expect(got.calls.at(-1)).toBe(`gh pr merge 41 -R owner/repo --squash --match-head-commit ${got.head}`);
  });

  // Plant: ask the merge on a head whose required check is not green, which arms auto-merge.
  it("scenario: a red ci-required at the pushed head refuses at the queue check, and no merge is asked", () => {
    const got = land({ ...fine, red: true });
    expect(got.code).toBe(1);
    expect(got.err).toContain("refused at the queue check: pr 77: ci-required is failure at");
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([]);
  });

  // Plant: refuse a draft at the queue check, as `queue` did, so a caller's wait for a merge never ends.
  it("scenario: `land.ts queue` marks a draft pull request ready, then queues it, as `admin` marks one ready before it waits", () => {
    const got = land({ ...fine, draft: true, command: ["queue", "77"] });
    expect(got.code, got.err).toBe(0);
    const asked = got.calls.filter((c) => /^gh pr (ready|merge)/.test(c));
    expect(asked).toEqual([
      "gh pr ready 77 -R owner/repo",
      `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`,
    ]);
  });

  // A caller's `&&` stops only on a non-zero exit, so every refusal of the queue command must give one.
  // The same split: 12 runs of a git fixture and the script, 14 s here, two laws by the pull request's state, 6 runs each.
  for (const prState of ["OPEN", "CLOSED"] as const) {
    it(`property: \`land.ts queue\` exits non-zero on every refusal and asks no merge then, zero when it queues, a ${prState} pull request`, () => {
      fc.assert(
        fc.property(
          fc.record({
            state: fc.constant(prState),
            draft: fc.boolean(),
            red: fc.boolean(),
            leak: fc.boolean(),
          }),
          (world) => {
            const got = land({ ...fine, ...world, command: ["queue", "77"] });
            const queues = world.state === "OPEN" && !world.red && !world.leak;

            expect(got.code, got.err).toBe(queues ? 0 : 1);
            expect(got.err.includes("land: refused at the"), got.err).toBe(!queues);
            expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(queues ? 1 : 0);
          },
        ),
        { seed: 1942, numRuns: 6 },
      );
    }, 300_000);
  }

  // Plant: read only ci-required in the wait, so a pull request GitHub starts no check on waits out its hour.
  it("scenario: `land.ts queue --wait-ci` exits 1 at once when the pull request turns to conflict, naming the conflict and the command that merges main in", () => {
    const got = land({ ...fine, pending: true, mergeable: "later", command: ["queue", "77", "--wait-ci"] });
    expect(got.code, got.err).toBe(1);
    expect(got.err).toContain("land: refused at the queue check: pr 77: it conflicts with main");
    expect(got.err).toContain("gh pr update-branch 77");
    expect(got.calls.filter((c) => /^gh pr (ready|merge)/.test(c))).toEqual([]);
  }, 120_000);

  // Plant: keep `--wait` as a wait for the merge, or let it run anything before it refuses.
  it("scenario: `land.ts queue --wait` is refused at once and names `--wait-ci`: it does not wait for the merge", () => {
    const got = land({ ...fine, pending: true, command: ["queue", "77", "--wait"] });
    expect(got.code, got.err).toBe(1);
    expect(got.err).toContain("land: refused at the queue check:");
    expect(got.err).toContain("--wait-ci");
    expect(got.err).toContain("does not wait for the merge");
    expect(got.calls.filter((c) => c !== "")).toEqual([]);
  }, 120_000);

  // Plant: let `wait` exit 0 on a check that ended red, so a caller's `&&` goes on to queue.
  it("scenario: `land.ts wait` exits 0 only on a ci-required success, and names the check run of one that failed", () => {
    const green = land({ ...fine, command: ["wait", "77"] });
    expect(green.code, green.err).toBe(0);
    expect(green.out).toContain("pr 77: ci-required succeeded at ");
    const red = land({ ...fine, red: true, command: ["wait", "77"] });
    expect(red.code).toBe(1);
    expect(red.err).toContain("land: refused at the wait check: pr 77: ci-required is failure at ");
    expect(red.err).toContain("https://github.com/owner/repo/runs/1");
    expect(red.calls.filter((c) => /^gh pr (ready|merge)/.test(c))).toEqual([]);
  }, 120_000);

  // Plants: run `check` on a part of the checks `queue` runs, or let it ask GitHub to change something.
  // The same split: 8 runs of two script runs each, 22 s here and 27 s of CI's 60 s limit, two laws by whether the body leaks, 4 runs each.
  for (const leaking of [false, true]) {
    it(`property: \`land.ts check\` refuses the same bodies as \`land.ts queue\`, names each missing name with its file, and changes nothing, ${leaking ? "with" : "without"} a leak`, () => {
      fc.assert(
        fc.property(
          fc.record({ named: fc.boolean(), leak: fc.constant(leaking), exports: fc.boolean() }),
          ({ named, leak, exports }) => {
            const section = named ? "\\n\\n## New names\\n\\n- `newThing`: the industry's word, with its source." : "";
            const body = `${full}${leak ? ` ${planted}` : ""}${section}`;
            const world = { ...fine, body, ...(exports ? { patch: "newThing" } : {}) };
            const checked = land({ ...world, command: ["check", "77"] });
            const queued = land({ ...world, command: ["queue", "77"] });
            const refused = leak || (exports && !named);

            expect(checked.code, checked.err).toBe(refused ? 1 : 0);
            expect(queued.code, queued.err).toBe(refused ? 1 : 0);
            expect(checked.err).not.toContain(planted);

            if (exports && !named && !leak) {
              for (const said of [checked.err, queued.err]) {
                expect(said).toContain("new names its ## New names section does not name: newThing (src/thing.ts)");
              }
            }

            // `check` reads and asks nothing that changes: no ready, no merge, no edit.
            expect(checked.calls.filter((c) => /^gh pr (ready|merge|edit)|-X (PATCH|POST)/.test(c))).toEqual([]);
          },
        ),
        { seed: 1270, numRuns: 4 },
      );
    }, 300_000);
  }

  // Plants: leave the sections check out of `check` or of `queue`, so one passes a body the other refuses (pull request 2320 merged with the draft placeholder and a New names section).
  it("scenario: `land.ts check` and `queue` refuse the draft placeholder and a body missing a section the pr skill requires, name what is missing, and pass a full body", () => {
    const placeholder = `${Sections.DRAFT_BODY}\\n\\n## New names\\n\\n- \`X\`: the industry's word, with its source.`;
    const noEvidence = "## Summary\\n\\nx\\n\\n## Merge Danger\\n\\nx";

    for (const command of [
      ["check", "77"],
      ["queue", "77"],
    ]) {
      const held = land({ ...fine, body: placeholder, command });
      expect(held.code, held.err).toBe(1);
      expect(held.err).toContain("still the draft placeholder sentence");
      expect(held.err).toContain("## Summary, ## Evidence, ## Merge Danger");
      expect(held.err).toContain(".agents/skills/pr/SKILL.md");

      const short = land({ ...fine, body: noEvidence, command });
      expect(short.code, short.err).toBe(1);
      expect(short.err).toContain("lacks the sections the pr skill requires: ## Evidence");
      expect(short.err).not.toContain("placeholder");

      const good = land({ ...fine, body: full, command });
      expect(good.code, good.err).toBe(0);
    }
  }, 180_000);

  // Plants: leave the sections check out of `ready`, so a quest finds a placeholder body only at the queue, after its push.
  it("scenario: `land.ts ready` refuses a body file that is the draft placeholder or lacks a pr skill section, names what is missing, and writes no record", () => {
    for (const readyBody of [
      `T652 fixture: one quest\n\n${Sections.DRAFT_BODY}\n`,
      "T652 fixture: one quest\n\n### Summary\n\nx\n\n### Evidence\n\nx\n",
    ]) {
      const got = land({ ...fine, readyBody, readyRefused: true, command: ["check", "77"] });

      expect(got.code, got.err).toBe(1);
      expect(got.err).toContain(".agents/skills/pr/SKILL.md");
      expect(got.err).toMatch(
        /still the draft placeholder sentence|lacks the sections the pr skill requires: ## Merge Danger/,
      );
      expect(got.recorded).toBe(false);
    }
  }, 120_000);

  // Plant: leave the sections check out of `draftPr`, so a body file edited after `ready` is pushed and opened as a draft.
  it("scenario: `land.ts run` refuses a body file that turned to the draft placeholder after `ready` took it, and changes and pushes nothing", () => {
    const got = land({ ...fine, laterBody: `T652 fixture: one quest\n\n${Sections.DRAFT_BODY}\n` });

    expect(got.code, got.err).toBe(1);
    expect(got.err).toContain("the PR body: its description is still the draft placeholder sentence");
    expect(got.err).toContain(".agents/skills/pr/SKILL.md");
    expect(got.calls.filter((c) => /^gh pr create|^gh api -X (PATCH|POST)/.test(c))).toEqual([]);
    expect(got.after).toEqual(got.before);
    expect(got.parents).toBe(1);
  }, 120_000);

  // Plants: pass a close line whose number is a GitHub issue (pull requests 2009 and 2004 did, and `merged` closed nothing), or check it in `queue` only.
  it("scenario: `land.ts check` and `queue` refuse a `fabrika close ticket` line that names a GitHub issue, say to use `Closes #N`, and pass an open tracker ticket", () => {
    const text = `${full}\\n\\nfabrika close ticket 1843`;
    const issue = { ...fine, body: text, tickets: "5", issues: "1843" };

    for (const command of [
      ["check", "77"],
      ["queue", "77"],
    ]) {
      const got = land({ ...issue, command });
      expect(got.code, got.err).toBe(1);
      expect(got.err).toContain("fabrika close ticket 1843: 1843 is an open GitHub issue, not a tracker ticket");
      expect(got.err).toContain("`Closes #1843`");
    }

    const ticket = land({ ...fine, body: text, tickets: "1843 5", command: ["check", "77"] });
    expect(ticket.code, ticket.err).toBe(0);
  }, 120_000);

  // Plants: leave the gate out of one command's path (`check`, `queue`, `merge`, `merge --admin`, `admin` or `arm`), so it takes a pull request the others refuse. pr/Gate.test.ts holds the same law on every path and every refusal; this one runs the commands.
  // Each world is its own law, 6 runs of one script run each, as the split above.
  const PATHS: ReadonlyArray<ReadonlyArray<string>> = [
    ["check", "77"],
    ["queue", "77"],
    // The two flags have no default, so each command names its own (a bare `merge 77` or `admin 77` is a usage error).
    ["merge", "77", "--admin=false"],
    ["merge", "77", "--admin"],
    ["admin", "77", "--wait"],
    ["arm", "77"],
  ];

  for (const [name, world, says] of [
    ["is titled `Plan:`", { title: "Plan: a quest" }, "its title starts `Plan:`"],
    [
      "holds an unsigned commit",
      { unsignedCommit: true },
      "1 commit(s) since main are not signed or made by stepcommit.sh:",
    ],
  ] as const) {
    it(`scenario: every command that merges or checks a pull request that ${name} refuses it with the gate's words, and asks GitHub for no ready or merge`, () => {
      for (const command of PATHS) {
        const got = land({ ...fine, ...world, command });
        expect(got.code, `${command.join(" ")}: ${got.err}`).toBe(1);
        expect(got.err, command.join(" ")).toContain(says);
        expect(
          got.calls.filter((c) => /^gh pr (ready|merge)/.test(c)),
          command.join(" "),
        ).toEqual([]);
      }
    }, 300_000);
  }

  // Plants: print the list of checks from `check` only, or a different one from a merge path, or leave it out of `run` or `arm`.
  it("scenario: `land.ts check` and every path that merges print the same line listing the checks the gate ran", () => {
    const checked = land({ ...fine, command: ["check", "77"] });
    expect(checked.code, checked.err).toBe(0);
    const line = checked.out.trim();
    expect(line).toMatch(/^pr 77: the merge gate passes \(not a can\/ branch; open, into main, no conflict;/);

    for (const command of [
      ["queue", "77"],
      ["merge", "77", "--admin=false"],
      ["merge", "77", "--admin"],
      ["admin", "77", "--wait"],
      ["arm", "77"],
    ]) {
      const got = land({ ...fine, command });
      expect(got.code, `${command.join(" ")}: ${got.err}`).toBe(0);
      expect(got.out.split("\n")[0], command.join(" ")).toBe(line);
    }

    // `run` says its own steps first, then the gate's line, then the queue's.
    const ran = land({ ...fine });
    expect(ran.code, ran.err).toBe(0);
    expect(ran.out.split("\n"), "run").toContain(line);
  }, 300_000);

  // Plants: skip the signature read in `check`, count only the branch's tip, or name no commit.
  it("scenario: `land.ts check` refuses a commit since main with no signature, names it, and passes when every commit has a note", () => {
    const unsigned = land({ ...fine, unsignedCommit: true, command: ["check", "77"] });
    expect(unsigned.code, unsigned.err).toBe(1);
    expect(unsigned.err).toContain("1 commit(s) since main are not signed or made by stepcommit.sh:");
    expect(unsigned.err).toContain(`${unsigned.head.slice(0, 8)} open the slice`);
    expect(unsigned.err).not.toContain("the quest's step");
    const signed = land({ ...fine, command: ["check", "77"] });
    expect(signed.code, signed.err).toBe(0);
    expect(signed.out).toContain("every commit since main signed");
  }, 120_000);

  // Plants: refuse a commit `stepcommit.sh` made because it has no note (a fix round signs nothing, and a `--commit-only` lead commit is signed by `land.ts run`), or exempt every commit whatever its author.
  it("scenario: `land.ts check` passes the commits stepcommit.sh made with no note, a fix round's and a --commit-only lead commit's, and still refuses a hand-made one beside them", () => {
    const made = land({ ...fine, toolCommits: true, command: ["check", "77"] });
    expect(made.code, made.err).toBe(0);
    const mixed = land({ ...fine, toolCommits: true, unsignedCommit: true, command: ["check", "77"] });
    expect(mixed.code, mixed.err).toBe(1);
    expect(mixed.err).toContain("1 commit(s) since main are not signed or made by stepcommit.sh:");
    expect(mixed.err).toContain(" open the slice");
    expect(mixed.err).not.toContain("T652");
  }, 120_000);

  // Plants: fetch into FETCH_HEAD and read it back (the flake: a fetch by another session at once swapped it, and `check` refused "the fetched main is not a commit"), or leave the ref the fetch made.
  it("scenario: `land.ts check` neither reads nor writes FETCH_HEAD, and leaves no ref behind", () => {
    const got = land({ ...fine, behind: true, strangerFetch: true, command: ["check", "77"] });
    expect(got.code, got.err).toBe(0);
    expect(got.strangerKept).toBe(true);
    expect(got.refsLeft).toBe("");
  }, 120_000);

  // Plant: fetch main into one shared ref or FETCH_HEAD, so copies that run at once swap each other's fetch.
  it("scenario: twelve `land.ts check` runs in one checkout at the same moment all pass", () => {
    const got = land({ ...fine, alongside: 12, command: ["check", "77"] });
    expect(got.code, got.err).toBe(0);
    expect(
      got.beside.map((b) => b.code),
      got.beside.map((b) => b.err).join("\n"),
    ).toEqual(Array.from({ length: 12 }, () => "0"));
    expect(got.refsLeft).toBe("");
  }, 120_000);

  // Plant: let a wait for a good admin merge end in a refusal, as the command did after the merge.
  it("scenario: `land.ts admin --wait` exits 0 after a good admin merge, and only a refusal exits 1", () => {
    const merged = land({ ...fine, command: ["admin", "77", "--wait"] });
    expect(merged.code, merged.err).toBe(0);
    expect(merged.out).toContain("pr 77: admin-merged at ");
    expect(merged.calls).toContain(`gh pr merge 77 -R owner/repo --squash --match-head-commit ${merged.head} --admin`);
    const refused = land({ ...fine, red: true, command: ["admin", "77", "--wait"] });
    expect(refused.code).toBe(1);
    expect(refused.calls.filter((c) => c.endsWith("--admin"))).toEqual([]);
  });

  it("T652 scenario: a mid-quest handover (no PR files) merges main, signs and pushes the -wip backup, then stops with no PR and nothing queued", () => {
    const got = land({ ...fine, behind: true, wip: true });
    expect(got.code, got.err).toBe(0);
    expect(got.calls.filter((c) => !c.startsWith("sign "))).toEqual(["push fabrikalfa/t652-fixture-wip HEAD"]);
  });
});

// R7: `land.ts review` (slice 1 of .kalfa/quests/review-record-PLAN.md). Git and the leak grep are real, on disposable repos; `gh` is a stub
// that keeps what the record posts (a comment, a status) and gives it back the way GitHub lists a head's statuses.
const reviewGh = `#!/bin/sh
echo "gh $*" >>"$LAND_CALLS"
case "$1 $2" in
"pr view")
  head=$(git -C "$LAND_QUEST" rev-parse HEAD)
  printf '{"number":%s,"headRefName":"fabrikalfa/t2338-fixture","headRefOid":"%s","baseRefName":"main","state":"%s","isDraft":false,"title":"T2338 fixture: a review","body":"","mergeCommit":null,"mergeable":"MERGEABLE"}\\n' "$3" "$head" "\${LAND_STATE:-OPEN}" ;;
"api -X")
  case "$4" in
  */comments) echo '{"id":1,"html_url":"https://github.com/owner/repo/pull/77#issuecomment-1"}' ;;
  */statuses/*)
    sha=\${4##*/}
    shift 4
    state=; description=; url=
    while [ $# -gt 0 ]; do
      case "$2" in
      state=*) state=\${2#state=} ;;
      description=*) description=\${2#description=} ;;
      target_url=*) url=\${2#target_url=} ;;
      esac
      shift 2
    done
    n=$(( $(cat "$LAND_STATUSES/count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" >"$LAND_STATUSES/count"
    echo "{\\"id\\":$n,\\"state\\":\\"$state\\",\\"context\\":\\"review\\",\\"description\\":\\"$description\\",\\"target_url\\":\\"$url\\",\\"creator\\":{\\"login\\":\\"fixture\\"}}" >>"$LAND_STATUSES/$sha"
    echo '{}' ;;
  esac ;;
"api --paginate")
  # args: api --paginate --slurp repos/owner/repo/commits/<sha>/statuses?per_page=100
  sha=\${4#*commits/}
  sha=\${sha%%/*}
  printf '[['
  [ ! -f "$LAND_STATUSES/$sha" ] || paste -sd, - <"$LAND_STATUSES/$sha" | tr -d '\\n'
  printf ']]\\n' ;;
esac
`;

const reviewing = () => {
  const dir = mkdtempSync(join(tmpdir(), "land-review-"));
  const [origin, quest] = [join(dir, "origin"), join(dir, "quest")];

  const env = {
    ...process.env,
    PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
    HOME: join(dir, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "user.useConfigOnly",
    GIT_CONFIG_VALUE_0: "true",
    GIT_AUTHOR_NAME: undefined,
    GIT_AUTHOR_EMAIL: undefined,
    GIT_COMMITTER_NAME: undefined,
    GIT_COMMITTER_EMAIL: undefined,
    EMAIL: undefined,
    MAIN: quest,
    BOXES: join(dir, "boxes"),
    REMOTE: origin,
    GH_REPO: "owner/repo",
    FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
    FABRIKA_LEAK_WORDS: join(dir, "words"),
    LAND_CALLS: join(dir, "calls"),
    LAND_QUEST: quest,
    LAND_STATUSES: join(dir, "statuses"),
    LAND_STATE: "OPEN",
    TYPESAFE_API_KEY: undefined,
  };

  const git = (at: string, ...args: string[]) => {
    const got = spawnSync(
      "/usr/bin/git",
      ["-C", at, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
      { encoding: "utf8", env, timeout: 10_000 },
    );

    expect(got.status, got.stderr).toBe(0);

    return got.stdout.trim();
  };

  for (const folder of ["bin", "home", "origin", "boxes", "statuses"]) {
    mkdirSync(join(dir, folder), { recursive: true });
  }

  writeFileSync(join(dir, "bin/gh"), reviewGh, { mode: 0o755 });
  writeFileSync(join(dir, "words"), `${planted}\n`);
  git(origin, "init", "-q", "--initial-branch=main");
  writeFileSync(join(origin, "base.txt"), "base\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "base");
  git(dir, "clone", "-q", origin, quest);
  git(quest, "checkout", "-q", "-b", "fabrikalfa/t2338-fixture");

  return {
    git: (...args: string[]) => git(quest, ...args),
    /** A commit on the branch that writes a file, and its sha. */
    commit: (file: string, text: string) => {
      writeFileSync(join(quest, file), text);
      git(quest, "add", ".");
      git(quest, "commit", "-qm", `write ${file}`);

      return git(quest, "rev-parse", "HEAD");
    },
    /** Main moves on origin, in a file of its own. */
    moveMain: (file: string) => {
      writeFileSync(join(origin, file), "main moved\n");
      git(origin, "add", ".");
      git(origin, "commit", "-qm", `main writes ${file}`);
    },
    review: (...args: string[]) =>
      spawnSync(process.execPath, [script, "review", "77", ...args], {
        cwd: quest,
        encoding: "utf8",
        env: { ...env, ...(args.includes("--closed") ? { LAND_STATE: "CLOSED" } : {}) },
        timeout: 60_000,
      }),
    closed: () => {
      env.LAND_STATE = "CLOSED";
    },
    calls: () => (existsSync(env.LAND_CALLS) ? readFileSync(env.LAND_CALLS, "utf8").trim().split("\n") : []),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const posts = (calls: ReadonlyArray<string>) => calls.filter((c) => c.startsWith("gh api -X POST"));

describe("R7: land.ts review (slice 1)", () => {
  // Plants: have a carry post a comment; have the second ask write again; print `recorded` for each; let a refusal exit 0.
  it("scenario: a fresh record, then a carry over a merge of main, then the same ask again: one comment and two statuses in all, and each line says which", () => {
    const r = reviewing();

    try {
      const first = r.commit("feature.txt", "the change\n");
      const fresh = r.review("--reviewed", first, "--reviewer", "a fixture reviewer, session one");
      expect(fresh.status, fresh.stderr).toBe(0);
      expect(fresh.stdout.trim()).toBe(
        `pr 77: review recorded on ${first.slice(0, 12)} (reviewed ${first.slice(0, 12)})`,
      );
      expect(posts(r.calls())).toHaveLength(2);

      r.moveMain("other.txt");
      r.git("fetch", "-q", "origin");
      r.git("merge", "-q", "--no-edit", "origin/main");
      const merged = r.git("rev-parse", "HEAD");
      expect(r.git("rev-parse", "HEAD^1")).toBe(first);

      const kept = r.review();
      expect(kept.status, kept.stderr).toBe(0);

      expect(kept.stdout.trim()).toBe(
        `pr 77: review carried to ${merged.slice(0, 12)} from ${first.slice(0, 12)} (reviewed ${first.slice(0, 12)}), kept`,
      );

      // One more status, and no comment.
      expect(posts(r.calls()).filter((c) => c.includes("/comments"))).toHaveLength(1);
      expect(posts(r.calls()).filter((c) => c.includes("/statuses/"))).toHaveLength(2);

      const again = r.review();
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout.trim()).toBe(`pr 77: review already recorded on ${merged.slice(0, 12)}`);
      expect(posts(r.calls())).toHaveLength(3);
    } finally {
      r.done();
    }
  }, 120_000);

  // Plants: map a refusal to success; post before the check; name no `--reviewed` in the carry's refusal.
  it("scenario: each refusal exits 1 with `land: refused at the review check:` and writes nothing: a carry with no earlier approval names `--reviewed`; a reviewed head that is not in the history, is not a commit, holds another change or no change; a closed pull request; flags that do not come together; and a leak", () => {
    const refusals: ReadonlyArray<{
      readonly name: string;
      readonly set: (r: ReturnType<typeof reviewing>) => ReadonlyArray<string>;
      readonly says?: string;
    }> = [
      {
        name: "a carry, and no earlier head holds an approval",
        set: (r) => {
          r.commit("feature.txt", "the change\n");

          return [];
        },
        says: "--reviewed",
      },
      {
        name: "a reviewed head that another branch holds",
        set: (r) => {
          r.git("checkout", "-q", "-b", "side", "origin/main");
          // Another file and message, so the side commit is not the head's own commit made twice in one second.
          const side = r.commit("side.txt", "the change\n");
          r.git("checkout", "-q", "fabrikalfa/t2338-fixture");
          r.commit("feature.txt", "the change\n");

          return ["--reviewed", side, "--reviewer", "a fixture reviewer"];
        },
      },
      {
        name: "a reviewed head that is no commit here",
        set: (r) => {
          r.commit("feature.txt", "the change\n");

          return ["--reviewed", "a".repeat(40), "--reviewer", "a fixture reviewer"];
        },
      },
      {
        name: "a reviewed head that holds another change",
        set: (r) => {
          const first = r.commit("feature.txt", "the change\n");
          r.commit("feature.txt", "the change, and one more\n");

          return ["--reviewed", first, "--reviewer", "a fixture reviewer"];
        },
      },
      {
        name: "a head that holds no change against main",
        set: (r) => ["--reviewed", r.git("rev-parse", "HEAD"), "--reviewer", "a fixture reviewer"],
      },
      {
        name: "a closed pull request",
        set: (r) => {
          const first = r.commit("feature.txt", "the change\n");
          r.closed();

          return ["--reviewed", first, "--reviewer", "a fixture reviewer"];
        },
      },
      {
        name: "a reviewed head with no reviewer",
        set: (r) => ["--reviewed", r.commit("feature.txt", "the change\n")],
        says: "--reviewer",
      },
      {
        name: "a reviewer on a carry",
        set: (r) => {
          r.commit("feature.txt", "the change\n");

          return ["--reviewer", "a fixture reviewer"];
        },
      },
      {
        name: "a reviewer's words the leak grep refuses",
        set: (r) => ["--reviewed", r.commit("feature.txt", "the change\n"), "--reviewer", `a reviewer ${planted}`],
      },
    ];

    for (const refusal of refusals) {
      const r = reviewing();

      try {
        const args = refusal.set(r);
        const got = r.review(...args);

        expect(got.status, `${refusal.name}: ${got.stderr}`).toBe(1);
        expect(got.stderr, refusal.name).toContain("land: refused at the review check: ");
        expect(got.stdout, refusal.name).toBe("");
        expect(posts(r.calls()), refusal.name).toEqual([]);
        expect(got.stdout + got.stderr, refusal.name).not.toContain(planted);

        if (refusal.says !== undefined) {
          expect(got.stderr, refusal.name).toContain(refusal.says);
        }
      } finally {
        r.done();
      }
    }
  }, 180_000);
});

// R11 and the flags of slice 2 (.kalfa/quests/review-record-PLAN.md): a quest that changes a reviewed path records its review before it queues, every
// command refuses a reviewed path with no record, and an admin merge goes past one only with a reason. Git and the leak grep are real, on
// disposable repos; `gh` is the stub above, which keeps the record's comment and status and gives them back as GitHub lists a head's statuses.
const ofCall = (calls: ReadonlyArray<string>, start: string) => calls.findIndex((c) => c.startsWith(start));

describe("R11: the quest paths record the review, and every command asks for it (slice 2)", () => {
  // Plants: queue before recording; record before the pull request is opened; ignore a refused record; pass a ticket of its own to `run`;
  // record the merged head as `reviewed` (a head the review never read).
  it("scenario: `land.ts run` with --reviewed and --reviewer, on a quest that changes a reviewed path, writes the record on the pushed head after the pull request is opened and before it queues, and the queue then passes", () => {
    const got = land({
      ...fine,
      behind: true,
      reviewedPath: true,
      command: ["run", "t652f", "652", "--reviewed", "{head}", "--reviewer", "a fixture reviewer, session one"],
    });

    expect(got.code, got.err).toBe(0);

    const opened = ofCall(got.calls, "gh pr create");
    const commented = ofCall(got.calls, "gh api -X POST repos/owner/repo/issues/77/comments");
    const statused = ofCall(got.calls, `gh api -X POST repos/owner/repo/statuses/${got.head}`);
    const queued = ofCall(got.calls, "gh pr merge 77");

    expect(opened).toBeGreaterThanOrEqual(0);
    expect(commented).toBeGreaterThan(opened);
    expect(statused).toBeGreaterThan(commented);
    expect(queued).toBeGreaterThan(statused);
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([
      `gh pr merge 77 -R owner/repo --squash --match-head-commit ${got.head}`,
    ]);

    // The record names the head the quest agent left (the one the review read), not the head the merge of main made, and the quest's own ticket.
    const said = got.calls.join("\n");
    expect(got.before[0]).not.toBe(got.head);
    expect(said).toContain(`reviewed=${got.before[0]}`);
    expect(said).toMatch(/"ticket":\s*652/);
  }, 120_000);

  it("scenario: `land.ts run` on a quest that changes a reviewed path, given no --reviewed and no --reviewer, stops at the queue naming the command that carries a record, and enqueues and writes nothing", () => {
    const got = land({ ...fine, reviewedPath: true });

    expect(got.code).toBe(1);
    expect(got.err).toContain("land.ts review 77");
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([]);
    expect(got.calls.filter((c) => c.startsWith("gh api -X POST"))).toEqual([]);
  }, 120_000);

  it("scenario: `land.ts run` whose record is refused stops before it queues: a reviewed head that is no commit here, and a reviewer the leak grep refuses, each writes nothing and enqueues nothing", () => {
    for (const flags of [
      ["--reviewed", "a".repeat(40), "--reviewer", "a fixture reviewer"],
      ["--reviewed", "{head}", "--reviewer", `a reviewer ${planted}`],
    ]) {
      const got = land({ ...fine, reviewedPath: true, command: ["run", "t652f", "652", ...flags] });

      expect(got.code, flags.join(" ")).toBe(1);
      expect(got.err, flags.join(" ")).toContain("refused at the review check");
      expect(
        got.calls.filter((c) => c.startsWith("gh pr merge")),
        flags.join(" "),
      ).toEqual([]);
      expect(
        got.calls.filter((c) => c.startsWith("gh api -X POST")),
        flags.join(" "),
      ).toEqual([]);
      expect(got.out + got.err, flags.join(" ")).not.toContain(planted);
    }
  }, 120_000);

  it("scenario: `land.ts run` takes no --ticket of its own: its ticket is the one it already names", () => {
    const got = land({
      ...fine,
      reviewedPath: true,
      command: ["run", "t652f", "652", "--reviewed", "{head}", "--reviewer", "a fixture reviewer", "--ticket", "7"],
    });

    expect(got.code).not.toBe(0);
    // The one flag it refuses is `--ticket`: `--reviewed` and `--reviewer` are taken.
    expect(got.err).toContain("--ticket");
    expect(got.err).not.toContain("--reviewed");
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([]);
  }, 120_000);

  // Plants: leave the review check out of one command; name the carry command for `arm` (which refuses even a pull request with a record); name `--override-review` for the queue.
  it("scenario: on a pull request that changes a reviewed path and holds no record, `check` and `queue` refuse naming the command that carries a record, `arm` names `land.ts queue`, and `merge --admin` names `--override-review`; none merges, arms or queues", () => {
    const rows: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
      [["check", "77"], "land.ts review 77"],
      [["queue", "77"], "land.ts review 77"],
      [["arm", "77"], "land.ts queue 77"],
      [["merge", "77", "--admin"], "--override-review"],
      [["admin", "77", "--wait"], "--override-review"],
    ];

    for (const [command, says] of rows) {
      const got = land({ ...fine, reviewedPath: true, command });

      expect(got.code, command.join(" ")).toBe(1);
      expect(got.err, command.join(" ")).toContain(says);
      expect(
        got.calls.filter((c) => c.startsWith("gh pr merge")),
        command.join(" "),
      ).toEqual([]);
    }
  }, 240_000);

  // Plants: wire the flag to nothing; write the override after the merge; write it right after the gate, before the checks that follow; merge with no reason.
  it("scenario: `land.ts admin --wait --override-review <reason>` on a pull request that changes a reviewed path and holds no record writes the override (a comment, then a `failure` status holding the reason) and only then merges past the queue", () => {
    const reason = "sev1 fix for the red main";
    const got = land({ ...fine, reviewedPath: true, command: ["admin", "77", "--wait", "--override-review", reason] });

    expect(got.code, got.err).toBe(0);

    const commented = ofCall(got.calls, "gh api -X POST repos/owner/repo/issues/77/comments");
    const statused = ofCall(got.calls, `gh api -X POST repos/owner/repo/statuses/${got.head}`);
    const merged = ofCall(got.calls, "gh pr merge 77");

    expect(commented).toBeGreaterThanOrEqual(0);
    expect(statused).toBeGreaterThan(commented);
    expect(merged).toBeGreaterThan(statused);
    expect(got.calls[merged]).toContain("--admin");

    const said = got.calls.join("\n");
    expect(said).toContain("state=failure");
    expect(said).toContain(`override v1 ${reason}`);
    expect(got.out).toContain(reason);
  }, 120_000);

  // Plants: take `--override-review` on `merge` with no `--admin` and drop it (the merge then goes through the queue as if no reason was given); print the
  // gate's review words for an override merge.
  it("scenario: `land.ts merge --override-review` without `--admin` (`--admin=false`) is refused, naming `--admin`, and nothing is merged or written; the line of an admin merge that went past a missing record on a reason does not say a review is on the head", () => {
    const got = land({
      ...fine,
      reviewedPath: true,
      command: ["merge", "77", "--admin=false", "--override-review", "sev1 fix"],
    });

    expect(got.code).toBe(1);
    expect(got.err).toContain("--admin");
    expect(got.calls.filter((c) => c.startsWith("gh pr merge"))).toEqual([]);
    expect(got.calls.filter((c) => c.startsWith("gh api -X POST"))).toEqual([]);

    const past = land({
      ...fine,
      reviewedPath: true,
      command: ["merge", "77", "--admin", "--override-review", "sev1 fix"],
    });

    expect(past.code, past.err).toBe(0);
    expect(past.out).not.toContain("a review on the head");
    expect(past.out).toContain("sev1 fix");
  }, 120_000);

  // Plant: write an override for a pull request that holds a record already, or for one that needs none.
  it("scenario: `land.ts admin --wait` of a docs-only pull request needs no reason and writes no override, with or without one", () => {
    for (const command of [
      ["admin", "77", "--wait"],
      ["admin", "77", "--wait", "--override-review", "not needed"],
    ]) {
      const got = land({ ...fine, command });

      expect(got.code, got.err).toBe(0);
      expect(got.calls.filter((c) => c.startsWith("gh api -X POST"))).toEqual([]);
    }
  }, 120_000);
});

/** What `land.ts --help` lists as subcommands, in the order it lists them. */
const listed = (): ReadonlyArray<string> => {
  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8", timeout: 60_000 });
  const after = help.stdout.split("SUBCOMMANDS")[1] ?? "";

  return after
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name !== "");
};

/**
 * Each subcommand of `land.ts` with a world that ends it fast, the files it writes in `runs/land` (a pull request's `<pr>.jsonl`, a
 * quest's `quest-<name>.jsonl`) and how it ends there. `last` is the one reader, and writes none. A subcommand `--help` lists that
 * has no row here fails the first law below, so an eleventh cannot go unrecorded by accident.
 */
const RECORDED: ReadonlyArray<{
  readonly command: string;
  readonly world: World;
  readonly files: Readonly<Record<string, "done" | "refused">>;
}> = [
  {
    command: "ready",
    world: {
      ...fine,
      readyRefused: true,
      readyBody: `T652 fixture: one quest\n\n${Sections.DRAFT_BODY}\n`,
      command: ["check", "77"],
    },
    files: { "quest-t652f.jsonl": "refused" },
  },
  { command: "run", world: { ...fine, command: ["run", "nope", "1"] }, files: { "quest-nope.jsonl": "refused" } },
  { command: "queue", world: { ...fine, state: "CLOSED", command: ["queue", "77"] }, files: { "77.jsonl": "refused" } },
  { command: "wait", world: { ...fine, red: true, command: ["wait", "77"] }, files: { "77.jsonl": "refused" } },
  { command: "check", world: { ...fine, state: "CLOSED", command: ["check", "77"] }, files: { "77.jsonl": "refused" } },
  { command: "arm", world: { ...fine, state: "CLOSED", command: ["arm", "77"] }, files: { "77.jsonl": "refused" } },
  {
    command: "review",
    world: { ...fine, state: "CLOSED", command: ["review", "77"] },
    files: { "77.jsonl": "refused" },
  },
  {
    command: "merge",
    world: { ...fine, state: "CLOSED", command: ["merge", "77", "--admin"] },
    files: { "77.jsonl": "refused" },
  },
  {
    command: "admin",
    world: { ...fine, state: "CLOSED", command: ["admin", "77", "--wait"] },
    files: { "77.jsonl": "refused" },
  },
  {
    command: "merged",
    world: { ...fine, state: "CLOSED", command: ["merged", "77", "78"] },
    files: { "77.jsonl": "done", "78.jsonl": "done" },
  },
  {
    command: "close-named",
    world: { ...fine, state: "CLOSED", command: ["close-named", "77"] },
    files: { "77.jsonl": "done" },
  },
  { command: "last", world: { ...fine, command: ["last", "77"] }, files: {} },
];

describe("land.ts leaves a start and an end line for every command (the land record, ticket 2344)", () => {
  // Plants: add a subcommand with no row (red: this law); leave one command unwrapped (red: its row, no started line).
  it("L13 scenario: the subcommands --help lists are the ones the record's table names, so none is added unrecorded", () => {
    expect(listed().toSorted()).toEqual(RECORDED.map((row) => row.command).toSorted());
  }, 120_000);

  for (const row of RECORDED) {
    // Plants: leave this one subcommand unwrapped (red: no started line), or write its ending in another file (red: the name).
    it(`L13 scenario: land.ts ${row.command} leaves ${Object.keys(row.files).length === 0 ? "no line of its own" : "a started line and one ending line in the file its key names"}`, () => {
      const got = land(row.world);

      // `last` is the reader: it ends well, and writes nothing.
      if (Object.keys(row.files).length === 0) {
        expect(got.code, got.err).toBe(0);
      }

      expect(
        Object.keys(got.landed)
          .filter((name) => name !== "quest-t652f.jsonl" || row.command === "ready")
          .toSorted(),
      ).toEqual(Object.keys(row.files).toSorted());

      for (const [file, ends] of Object.entries(row.files)) {
        const lines = got.landed[file] ?? [];
        // `ready` is also the setup of every other world, so its own record is the one that holds its start.
        const own = lines.filter((line) => line._tag === "started" && line.command === row.command);

        expect(own, file).toHaveLength(1);
        expect(lines.at(-1)?._tag, file).toBe(ends);
        expect(
          lines.filter((line) => line._tag !== "started" && line._tag !== "heartbeat").map((line) => line._tag),
          file,
        ).toEqual([ends]);
        expect(own[0], file).toMatchObject({ argv: expect.arrayContaining([row.command]) });
      }
    }, 120_000);
  }

  // Plants: wrap only the success path (red: the refused rows); change the exit code, or what is printed, when the record cannot be
  // written (red: the blocked run differs).
  const ENDED: ReadonlyArray<{
    readonly name: string;
    readonly world: World;
    readonly code: number;
    readonly ends: "done" | "refused" | "failed";
    /** The record's file the command's own lines are in. */
    readonly file: string;
    /** For a refusal, the check it says. */
    readonly check?: string;
  }> = [
    {
      name: "a refusal",
      world: { ...fine, state: "CLOSED", command: ["check", "77"] },
      code: 1,
      ends: "refused",
      file: "77.jsonl",
      check: "body",
    },
    { name: "a success", world: { ...fine, command: ["wait", "77"] }, code: 0, ends: "done", file: "77.jsonl" },
    {
      name: "a missing ready file",
      world: { ...fine, command: ["run", "nope", "1"] },
      code: 1,
      ends: "refused",
      file: "quest-nope.jsonl",
      check: "ready",
    },
    // A failure that is no refusal: `ready` writes its state folder with no mapping to a refusal, so it ends as a plain failure.
    {
      name: "a failure that is no refusal",
      world: { ...fine, boxesUnderFile: true, command: ["ready", "t652f", "--tree", "{tree}"] },
      code: 1,
      ends: "failed",
      file: "quest-t652f.jsonl",
    },
  ];

  for (const row of ENDED) {
    it(`L15 scenario: ${row.name} through the real land.ts ends its record with how it ended, and a record that cannot be written changes neither its exit code nor its output`, () => {
      const normal = land(row.world);
      const blocked = land({ ...row.world, blockRecord: true });

      expect(normal.code, normal.err).toBe(row.code);
      const end = normal.landed[row.file]?.at(-1);
      expect(end?._tag).toBe(row.ends);

      if (row.ends === "refused") {
        // The record says the check and the reason stderr says.
        expect(end?.check).toBe(row.check);
        expect(end?.reason).toBeTruthy();
        expect(normal.err).toContain(`land: refused at the ${end?.check} check: ${end?.reason}`);
      }

      if (row.ends === "failed") {
        expect(end?.reason).toBeTruthy();
        // A failure that is no refusal is never read as one: stderr names no refusal, as before.
        expect(normal.err).not.toContain("land: refused at the");
      }

      // The same exit and the same output, and one more line on stderr that says the record is down.
      expect(blocked.code, blocked.err).toBe(normal.code);
      // Two runs of one world differ in the commits' hashes, which a clock sets.
      const plain = (text: string) => text.replaceAll(/[0-9a-f]{40}/g, "<commit>");
      expect(plain(blocked.out)).toBe(plain(normal.out));

      const [had, has] = [
        normal.err.split("\n").filter((line) => line !== ""),
        blocked.err.split("\n").filter((line) => line !== ""),
      ];

      expect(has).toHaveLength(had.length + 1);
      expect(has.filter((line) => !had.includes(line))).toHaveLength(1);
      expect(blocked.landed).toEqual({});
    }, 180_000);
  }

  // Plant: write a refusal's `output` into the record, as well as to stderr.
  it("L3 scenario: [secrets] the output a refusal carries (the changed files of a dirty tree) is on stderr as before and never in the record", () => {
    const got = land({ ...fine, dirty: true });

    expect(got.code).toBe(1);
    expect(got.err).toContain("quest.txt");
    expect(JSON.stringify(got.landed)).not.toContain("quest.txt");
    expect(got.landed["quest-t652f.jsonl"]?.at(-1)).toMatchObject({ _tag: "refused", check: "check" });
  }, 120_000);

  // Plants: read a pull request's number as a quest's name (red: no line for `77`); read a quest's name as a number; ignore --attempts
  // (red: the refusal of 0); read another file than the key's (red: no line).
  it("L14 scenario: land.ts last reads the record a command left, by pull request number or by quest name, and refuses --attempts below 1", () => {
    const pr = land({ ...fine, state: "CLOSED", command: ["check", "77"], afterwards: ["last", "77"] });
    expect(pr.next?.code, pr.next?.err).toBe(0);
    expect(pr.next?.out.trim().split("\n")).toHaveLength(1);
    expect(pr.next?.out).toContain("check 77");

    const quest = land({ ...fine, command: ["run", "nope", "1"], afterwards: ["last", "nope"] });
    expect(quest.next?.code, quest.next?.err).toBe(0);
    expect(quest.next?.out).toContain("run nope 1");

    // A quest that no command has run for has no record to read, and a number that no pull request has the same.
    const none = land({ ...fine, command: ["check", "77"], afterwards: ["last", "78"] });
    expect(none.next?.code).toBe(0);
    expect(none.next?.out).not.toContain("check 77");

    const zero = land({ ...fine, command: ["check", "77"], afterwards: ["last", "77", "--attempts", "0"] });
    expect(zero.next?.code).toBe(1);
    expect(zero.next?.err).toContain("--attempts");
  }, 180_000);

  // Plant: delete the record's name check (red: a file is made for the name, outside runs/land).
  it("L10 scenario: a quest name that is no plain name (a slash, `..`) leaves no record anywhere, costs one stderr line, and the command goes on to its own refusal", () => {
    const dir = mkdtempSync(join(tmpdir(), "land-name-"));

    try {
      const main = join(dir, "main");
      mkdirSync(join(main, "runs/land/quest-a"), { recursive: true });

      const env = {
        ...process.env,
        MAIN: main,
        BOXES: join(dir, "boxes"),
        GH_REPO: "owner/repo",
        REMOTE: join(dir, "origin"),
        FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
        TYPESAFE_API_KEY: undefined,
      };

      // `ready` on a tree that is no checkout: it refuses at once, whatever the quest is called.
      const ready = (quest: string) =>
        spawnSync(process.execPath, [script, "ready", quest, "--tree", join(dir, "nowhere")], {
          encoding: "utf8",
          env,
          timeout: 60_000,
        });

      const plain = ready("t652f");
      const bad = ready("a/../../escape");
      const lines = (text: string) => text.split("\n").filter((line) => line !== "");

      expect(plain.status).toBe(1);
      expect(bad.status).toBe(1);
      // The same refusal, and one line more: the record that could not be made.
      expect(lines(bad.stderr)).toHaveLength(lines(plain.stderr).length + 1);
      expect(readdirSync(join(main, "runs/land")).toSorted()).toEqual(["quest-a", "quest-t652f.jsonl"]);
      // Nothing escaped through the folder the name walked into.
      expect(readdirSync(dir).toSorted()).toEqual(["main"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  // Plant: accept 0 as a period (red: the first refusal).
  it("L6 scenario: a LAND_LOG_MINUTES that is no whole number of at least 1 refuses the command at its start and names the variable; a good one runs it", () => {
    for (const bad of ["0", "-3", "2.5", "abc"]) {
      const got = land({ ...fine, command: ["check", "77"], settings: { LAND_LOG_MINUTES: bad } });

      expect(got.code, bad).toBe(1);
      expect(got.err, bad).toContain("LAND_LOG_MINUTES");
      expect(
        got.calls.filter((call) => call !== ""),
        bad,
      ).toEqual([]);
    }

    const good = land({ ...fine, command: ["check", "77"], settings: { LAND_LOG_MINUTES: "7" } });
    expect(good.code, good.err).toBe(0);
  }, 180_000);
});
