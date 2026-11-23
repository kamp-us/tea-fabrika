import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling (ticket 652). Git and the leak grep are real, on disposable repos. The signer,
// botpush and gh are stubs that say what they were asked. The stub signer adds a real
// note to HEAD, so a rollback can be seen in refs/notes/fabrika.
const script = join(import.meta.dirname, "land.ts");

const planted = "plantedleakword652";

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
  printf '{"number":%s,"headRefName":"fabrikalfa/t652-fixture","headRefOid":"%s","baseRefName":"main","state":"%s","isDraft":%s,"title":"%s","body":"%s","mergeCommit":null,"mergeable":"%s"}\\n' "$3" "$head" "\${LAND_STATE:-OPEN}" "$draft" "\${LAND_TITLE:-T652 fixture: one quest}" "\${LAND_BODY:-What the quest did.}" "$mergeable" ;;
"api graphql") echo '{"data":{"repository":{"mergeQueue":null}}}' ;;
"api --paginate")
  # The open GitHub issues, one number a line, when it is the issues list that is asked for.
  case "$3" in */issues?*) for n in $LAND_ISSUES; do echo "$n"; done; exit 0 ;; esac
  # The files the pull request changes, one JSON row each: one new export when a law names one.
  [ -z "\${LAND_PATCH:-}" ] || printf '{"path":"src/thing.ts","patch":"@@ -0,0 +1 @@\\\\n+export const %s = 1"}\\n' "$LAND_PATCH" ;;
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
  /** The pull request's description, with `\n` for a new line; a short line when left out. */
  readonly body?: string;
  /** The tracker's open tickets, and GitHub's open issues, as space-separated numbers. */
  readonly tickets?: string;
  readonly issues?: string;
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
};

const land = (world: World) => {
  const dir = mkdtempSync(join(tmpdir(), "land-"));

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
      MAIN: join(dir, world.command ? "quest" : "main"),
      LAND_DRAFT: world.draft ? "1" : "",
      LAND_STATE: world.state ?? "OPEN",
      LAND_MERGEABLE: world.mergeable ?? "MERGEABLE",
      LAND_BODY: world.body ?? "What the quest did.",
      LAND_PATCH: world.patch ?? "",
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

    for (const folder of ["bin", "home", "origin", "boxes", "main/.agents/skills/plan/scripts"]) {
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
    git(quest, "checkout", "-q", "-b", "fabrikalfa/t652-fixture");
    writeFileSync(join(quest, "quest.txt"), world.leak ? `the quest, with ${planted}\n` : "the quest\n");
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
      ["body.md", "T652 fixture: one quest\n\nWhat the quest did.\n\nfabrika close ticket 652\n"],
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

    expect(said.status, said.stderr).toBe(0);
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

    const before = [git(quest, "rev-parse", "HEAD"), git(quest, "rev-parse", "refs/notes/fabrika")];
    const ran = script_(...(world.command ?? ["run", "t652f", "652"]));
    expect(ran.error).toBeUndefined();
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
      lead: lead[1],
      // The quest's own lead commit carries a note once the run is over.
      leadNoted:
        lead[1] !== undefined &&
        spawnSync("/usr/bin/git", ["-C", quest, "notes", "--ref=fabrika", "show", lead[1]], { env }).status === 0,
      state: readFileSync(join(dir, "boxes/state/t652f.md"), "utf8"),
      head,
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

  it("T652 scenario: an open PR is updated through the REST API, never gh pr edit (AGENTS.md)", () => {
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
  it("scenario: `land.ts queue --wait` exits 1 at once when the pull request turns to conflict, naming the conflict and the command that merges main in", () => {
    const got = land({ ...fine, pending: true, mergeable: "later", command: ["queue", "77", "--wait"] });
    expect(got.code, got.err).toBe(1);
    expect(got.err).toContain("land: refused at the queue check: pr 77: it conflicts with main");
    expect(got.err).toContain("gh pr update-branch 77");
    expect(got.calls.filter((c) => /^gh pr (ready|merge)/.test(c))).toEqual([]);
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
            const body = `What it does.${leak ? ` ${planted}` : ""}${section}`;
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

  // Plants: pass a close line whose number is a GitHub issue (pull requests 2009 and 2004 did, and `merged` closed nothing), or check it in `queue` only.
  it("scenario: `land.ts check` and `queue` refuse a `fabrika close ticket` line that names a GitHub issue, say to use `Closes #N`, and pass an open tracker ticket", () => {
    const text = "What it does.\\n\\nfabrika close ticket 1843";
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
