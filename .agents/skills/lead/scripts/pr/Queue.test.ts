// Today's lead tooling. Queue's laws (a pull request whose steps passed lands on green CI and a clean leak check alone) on the test layers: nothing here asks GitHub, the
// tracker or the leak grep, and nothing sweeps. The laws of the retired catchup.sh that still have
// a job moved here: the state gate, the one pinned squash, and the ticket close of the ticket-close rule (T410).
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Fiber, Layer, Option, Schema, Match } from "effect";
import { TestClock } from "effect/testing";
import { Checks, ChecksError, type Job } from "../ci/Checks.ts";
import * as ChecksTest from "../ci/ChecksTest.ts";
import type { PullRequest } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes } from "./Pushes.ts";
import * as PushesTest from "./PushesTest.ts";
import * as Queue from "./Queue.ts";
import * as Sections from "./Sections.ts";
import * as SignaturesTest from "./SignaturesTest.ts";
import * as SweepsTest from "./SweepsTest.ts";
import * as TicketsCli from "./TicketsCli.ts";
import * as TicketsTest from "./TicketsTest.ts";

const oid = "0123456789abcdef0123456789abcdef01234567";

const merged = "feedfacefeedfacefeedfacefeedfacefeedface";

const repo = "fixture/repo";

const State = Schema.Literals(["OPEN", "CLOSED", "MERGED"]);

/** How the required check stands at the head: not made yet, or one of GitHub's answers. */
const Required = Schema.Literals(["none", "queued", "in_progress", "success", "failure", "cancelled", "skipped"]);

/** Which leak check refuses, by its method's name, or none. */
const Leak = Schema.Literals(["clean", "leakChange", "leakGrep", "leakText"]);

/** A description as the pr skill's template writes it. */
const full = "## Summary\n\nWhat it does.\n\n## Evidence\n\nA test.\n\n## Merge Danger\n\n**Door:** two-way\n";

const refused = new LeakGrepRefused({ reason: "private_word" });

/** The one leak check that refuses, with the error it refuses with. */
const leaking = (leak: typeof Leak.Type): PushesTest.Failing =>
  Match.value(leak).pipe(
    Match.when("clean", () => ({})),
    Match.when("leakChange", () => ({ leakChange: refused })),
    Match.when("leakGrep", () => ({ leakGrep: refused })),
    Match.orElse(() => ({ leakText: refused })),
  );

const job = (stands: typeof Required.Type): Option.Option<Job> =>
  stands === "none"
    ? Option.none()
    : stands === "queued" || stands === "in_progress"
      ? Option.some({ id: 1, status: stands, conclusion: null })
      : Option.some({ id: 1, status: "completed", conclusion: stands });

type World = {
  readonly state?: typeof State.Type;
  readonly draft?: boolean;
  readonly more?: PullRequestsTest.More;
  readonly required?: typeof Required.Type;
  readonly leak?: typeof Leak.Type;
  readonly open?: ReadonlyArray<number>;
  readonly failing?: {
    readonly prs?: PullRequestsTest.Failing;
    readonly tickets?: TicketsTest.Failing;
    readonly sweep?: string;
  };
};

/** Fresh memory for one run: GitHub with pull request 900, the leak grep, the tracker and the sweeps. */
const memory = (w: World = {}) => {
  const pr: PullRequest = { number: 900, head: "fabrikalfa/x", oid, state: w.state ?? "OPEN", draft: w.draft ?? false };
  const github = PullRequestsTest.world([pr]);
  github.more.set(900, { title: "T1: a title", body: full, ...w.more });
  const remote = PushesTest.remote();
  const tracker = TicketsTest.world(w.open ?? []);
  const sweeps = SweepsTest.count();

  const layer = Layer.mergeAll(
    PullRequestsTest.layer(github, w.failing?.prs),
    PushesTest.layer(remote, leaking(w.leak ?? "clean")),
    ChecksTest.layer([job(w.required ?? "success")], ""),
    TicketsTest.layer(tracker, w.failing?.tickets),
    SweepsTest.layer(sweeps, w.failing?.sweep),
    SignaturesTest.layer(),
  );

  return { github, remote, tracker, sweeps, layer };
};

const add = (m: ReturnType<typeof memory>) => Queue.add({ dir: ".", pr: 900 }).pipe(Effect.provide(m.layer));

/** One add, and the leak checks it asked for, read inside the layer that recorded them. */
const added = (m: ReturnType<typeof memory>) =>
  Effect.gen(function* () {
    const answer = yield* Effect.result(Queue.add({ dir: ".", pr: 900 }));

    return { answer, leaks: yield* Recorder.calls(Pushes) };
  }).pipe(Effect.provide(m.layer));

const settle = (m: ReturnType<typeof memory>) => Queue.settle({ repo, pr: 900 }).pipe(Effect.provide(m.layer));

describe("add: a finished pull request enters GitHub's merge queue by one pinned squash (a pull request whose steps passed lands on green CI and a clean leak check alone)", () => {
  // Plants: ask the merge before a leak check; ask it on a red or unfinished head (which arms
  // auto-merge); ask it for a closed one; mark a draft ready before the leak checks or for a pull
  // request that is refused anyway; pin a head other than the one that was read.
  it.effect.prop(
    "property: it is asked once, pinned to the head that was read, only when the pull request is open, into main, clean on all three leak checks and green on ci-required, a draft marked ready first; any other world asks nothing",
    {
      state: State,
      draft: Schema.Boolean,
      base: Schema.Literals(["main", "fabrikalfa/parent"]),
      leak: Leak,
      required: Required,
    },
    ({ state, draft, base, leak, required }) =>
      Effect.gen(function* () {
        const m = memory({
          state,
          draft,
          more: { base, mergeCommit: state === "MERGED" ? merged : null },
          leak,
          required,
        });

        const { answer, leaks } = yield* added(m);
        const open = state === "OPEN" && base === "main";
        const enters = open && leak === "clean" && required === "success";
        // A draft is marked ready once the leak checks pass, even when the check then keeps it out.
        const readied = open && draft && leak === "clean";

        expect(m.github.calls).toEqual([
          ...(readied ? [{ _tag: "ready", number: 900 }] : []),
          ...(enters ? [{ _tag: "enqueue", number: 900, oid }] : []),
        ]);
        expect(answer._tag === "Success" && answer.success._tag === "queued").toBe(enters);

        if (enters) {
          // Every leak check ran, on the head and on the words a squash puts on main, before the ask.
          expect(leaks).toEqual([
            { method: "leakChange", args: [".", oid] },
            { method: "leakGrep", args: [".", oid] },
            { method: "leakText", args: [".", `T1: a title\n\n${full}`] },
          ]);
        }

        // A pull request that may not enter is refused before anything is fetched or read.
        if (!open) {
          expect(leaks).toEqual([]);
        }
      }),
  );

  // vector: catchup.sh's own lines for a pull request that is not open and ready, kept word for word.
  it.effect("vector: merged is done and says where; closed and another base each refuse with one line", () =>
    Effect.gen(function* () {
      const done = yield* add(memory({ state: "MERGED", more: { mergeCommit: merged } }));
      expect(Queue.line(done)).toBe(`pr 900: already merged at ${merged}`);
      const closed = yield* Effect.flip(add(memory({ state: "CLOSED" })));
      expect(closed).toMatchObject({ _tag: "NotQueued", reason: "pr 900: closed, not merged" });
      const stacked = yield* Effect.flip(add(memory({ more: { base: "fabrikalfa/parent" } })));
      expect(stacked).toMatchObject({ reason: "pr 900: merges into fabrikalfa/parent, not main; refused" });
    }),
  );

  // Plant: refuse a draft for being a draft, as `land.ts queue` did, so a caller waits for a merge that never comes.
  it.effect(
    "scenario: a draft is marked ready after its leak checks and before its ci-required is read, then queued",
    () =>
      Effect.gen(function* () {
        const m = memory({ draft: true });
        const { answer, leaks } = yield* added(m);
        expect(answer).toMatchObject({ _tag: "Success", success: { _tag: "queued", pr: 900, oid } });
        expect(m.github.calls).toEqual([
          { _tag: "ready", number: 900 },
          { _tag: "enqueue", number: 900, oid },
        ]);
        expect(leaks).toHaveLength(3);

        const leaky = memory({ draft: true, leak: "leakText" });
        expect(yield* Effect.flip(add(leaky))).toMatchObject({ reason: "private_word" });
        expect(leaky.github.calls).toEqual([]);
      }),
  );

  it.effect("scenario: a queued answer says queued, never merged, and names the head", () =>
    Effect.gen(function* () {
      const answer = yield* add(memory());
      expect(answer).toEqual({ _tag: "queued", pr: 900, oid });
      expect(Queue.line(answer)).toBe(`pr 900: queued at ${oid}; GitHub tests it on newest main and merges it`);
    }),
  );

  it.effect(
    "scenario: a check that is not green names how it stands, and a pull request GitHub cannot show fails",
    () =>
      Effect.gen(function* () {
        const red = yield* Effect.flip(add(memory({ required: "failure" })));
        expect(red).toMatchObject({ _tag: "NotQueued" });
        expect(red._tag === "NotQueued" ? red.reason : "").toContain(`ci-required is failure at ${oid}`);
        const none = yield* Effect.flip(add(memory({ required: "none" })));
        expect(none._tag === "NotQueued" ? none.reason : "").toContain("ci-required is missing");
        const unread = yield* added(memory({ failing: { prs: { view: "gh: offline" } } }));
        expect(unread.answer._tag === "Failure" ? unread.answer.failure._tag : null).toBe("PullRequestsError");
        expect(unread.leaks).toEqual([]);
        const refused = memory({ failing: { prs: { enqueue: "gh: head moved" } } });
        expect((yield* Effect.flip(add(refused)))._tag).toBe("PullRequestsError");
      }),
  );

  // Plants: ask the merge while the check still runs; wait past the limit; never read again.
  it.effect(
    "scenario: a quest's wait reads the required check again until it ends, asks only on green, and gives up at its limit with nothing asked",
    () =>
      Effect.gen(function* () {
        const waited = (polls: ReadonlyArray<ChecksTest.Poll>) =>
          Effect.gen(function* () {
            const m = memory();
            const layer = Layer.merge(m.layer, ChecksTest.layer(polls, ""));

            const fiber = yield* Queue.add({ dir: ".", pr: 900, wait: { minutes: 5, every: 60 } }).pipe(
              Effect.provide(layer),
              Effect.result,
              Effect.forkChild,
            );

            yield* TestClock.adjust("6 minutes");

            return { answer: yield* Fiber.join(fiber), calls: m.github.calls };
          });

        const unreachable = new ChecksError({ reason: "gh: offline" });
        const green = yield* waited([job("none"), unreachable, job("in_progress"), job("success")]);
        expect(green.answer._tag).toBe("Success");
        expect(green.calls).toEqual([{ _tag: "enqueue", number: 900, oid }]);
        const red = yield* waited([job("queued"), job("failure")]);
        expect(red.answer._tag).toBe("Failure");
        expect(red.calls).toEqual([]);
        const never = yield* waited([job("in_progress")]);
        expect(never.answer._tag === "Failure" ? String(never.answer.failure.reason) : "").toContain(
          "ci-required is in_progress",
        );
        expect(never.calls).toEqual([]);
      }),
  );

  // Plants: read the first run's green and stop (the 2044 and 2049 loops); keep reading the head first read; call a cancelled
  // run a pass, or leave it unnamed.
  it.effect(
    "scenario: the wait follows the check at the head as it stands: a second run at one head, a head that moves, and a cancelled run",
    () =>
      Effect.gen(function* () {
        const next = "f".repeat(40);

        /** The check at each head, one answer a read; the head the pull request holds changes after read `moveAt`. */
        const waiting = (answers: Record<string, ReadonlyArray<Job>>, moveAt?: number) =>
          Effect.gen(function* () {
            const m = memory();
            const reads: Array<string> = [];

            const checks = Layer.succeed(
              Checks,
              Checks.of({
                job: (head) =>
                  Effect.sync(() => {
                    const seen = reads.filter((h) => h === head).length;
                    reads.push(head);
                    const list = answers[head] ?? [];

                    if (moveAt !== undefined && reads.length >= moveAt) {
                      m.github.prs[0] = { ...m.github.prs[0]!, oid: next };
                    }

                    return Option.fromUndefinedOr(list[Math.min(seen, list.length - 1)]);
                  }),
                started: () => Effect.succeed(true),
                log: () => Effect.succeed(""),
              }),
            );

            const fiber = yield* Queue.required(oid, { minutes: 30, every: 60 }, 900).pipe(
              Effect.provide(Layer.merge(m.layer, checks)),
              Effect.forkChild,
            );

            yield* TestClock.adjust("31 minutes");

            return { at: yield* Fiber.join(fiber), reads };
          });

        const running = { id: 1, status: "in_progress", conclusion: null };
        const second = { id: 2, status: "queued", conclusion: null };
        const cancelled = { id: 2, status: "completed", conclusion: "cancelled" };
        const green = { id: 3, status: "completed", conclusion: "success" };

        // A second run at the same head replaces the first as the latest check run; its end is the one read.
        const twice = yield* waiting({ [oid]: [running, second, cancelled] });
        expect(twice.at.job).toEqual(Option.some(cancelled));
        expect(twice.at.oid).toBe(oid);
        const said = Queue.verdict(repo, 900, twice.at);
        expect(said.ok).toBe(false);
        expect(said.text).toContain("was cancelled");
        expect(said.text).toContain(`https://github.com/${repo}/runs/2`);

        // A head that moves: the check at the old head never ends, the one at the new head has.
        const moves = yield* waiting({ [oid]: [running], [next]: [green] }, 1);
        expect(moves.at.oid).toBe(next);
        expect(moves.at.job).toEqual(Option.some(green));
        expect(Queue.verdict(repo, 900, moves.at)).toEqual({
          ok: true,
          text: `pr 900: ci-required succeeded at ${next}`,
        });

        // A check that ended at a head the pull request has left is read again at the new one.
        const left = yield* waiting({ [oid]: [green], [next]: [running, { ...green, id: 4 }] }, 1);
        expect(left.at.oid).toBe(next);
        expect(left.at.job).toEqual(Option.some({ ...green, id: 4 }));

        // A check that never ends is read at its limit, not ended, and says so.
        const never = yield* waiting({ [oid]: [running] });
        expect(Queue.verdict(repo, 900, never.at)).toEqual({
          ok: false,
          text: `pr 900: ci-required is in_progress at ${oid}, not ended`,
        });
      }),
  );

  // Plants: mark a draft ready while no run has started at its head (the ready event seconds after a push starts a second run on one commit,
  // and the required check stays expected); read the run once with a wait; drop the wait's limit.
  it.effect(
    "scenario: a draft is marked ready only once a CI run has started at its head; with a wait it is given time to start, without one it is refused",
    () =>
      Effect.gen(function* () {
        const waited = (starts: ReadonlyArray<boolean>, wait: Queue.Wait | undefined) =>
          Effect.gen(function* () {
            const m = memory({ draft: true });
            const layer = Layer.merge(m.layer, ChecksTest.layer([job("success")], "", starts));

            const fiber = yield* Queue.add({ dir: ".", pr: 900, ...(wait ? { wait } : {}) }).pipe(
              Effect.provide(layer),
              Effect.result,
              Effect.forkChild,
            );

            yield* TestClock.adjust("6 minutes");

            return { answer: yield* Fiber.join(fiber), calls: m.github.calls };
          });

        const later = yield* waited([false, false, true], { minutes: 5, every: 60 });
        expect(later.answer._tag).toBe("Success");
        expect(later.calls).toEqual([
          { _tag: "ready", number: 900 },
          { _tag: "enqueue", number: 900, oid },
        ]);

        const never = yield* waited([false], { minutes: 5, every: 60 });
        expect(never.answer._tag === "Failure" ? String(never.answer.failure.reason) : "").toContain(
          `no CI run has started at ${oid}`,
        );
        expect(never.calls).toEqual([]);

        const once = yield* waited([false, true], undefined);
        expect(once.answer._tag).toBe("Failure");
        expect(once.calls).toEqual([]);

        const started = yield* waited([true], undefined);
        expect(started.answer._tag).toBe("Success");
      }),
  );

  // Plants: add --admin or --auto; merge with another method; drop the head pin.
  it.prop(
    "property: the one merge call is a squash pinned to the head, with no --admin, no --auto and no other method",
    {
      number: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99999 })),
      head: Schema.Literals([oid, merged]),
    },
    ({ number, head }) => {
      const args = PullRequestsGh.mergeArgs(repo, number, head);
      expect(args).toEqual(["pr", "merge", String(number), "-R", repo, "--squash", "--match-head-commit", head]);

      return true;
    },
  );
  // Plants: skip the names check, read it after the merge is asked, or read the title for the section.
  it.effect.prop(
    "property: a diff that exports a new name is queued only when its description names it under ## New names; else it is refused with the name and the merge is never asked (a new helper names the tools it searched, and a new name cites the industry's word)",
    { named: Schema.Boolean, name: Schema.Literals(["Names", "refusal", "PatchRow"]) },
    ({ named, name }) =>
      Effect.gen(function* () {
        const lines = named ? `\n\n## New names\n\n- \`${name}\`: the industry's word, with its source.` : "";
        const m = memory({ more: { body: `${full}${lines}` } });
        m.github.patches.set(900, [{ path: "src/a.ts", patch: `@@ -0,0 +1 @@\n+export const ${name} = 1;` }]);
        const answer = yield* Effect.result(add(m));
        expect(m.github.calls).toEqual(named ? [{ _tag: "enqueue", number: 900, oid }] : []);

        if (!named) {
          expect(answer).toMatchObject({ _tag: "Failure", failure: { _tag: "NotQueued" } });
          expect(answer._tag === "Failure" && answer.failure.reason).toContain(`pr 900: its diff exports new names`);
          expect(answer._tag === "Failure" && answer.failure.reason).toContain(name);
        }
      }),
  );
});

describe("body: the description is the pr skill's template, never the draft placeholder (pull request 2320 merged with the placeholder and a ## New names section)", () => {
  const answer = (text: string) =>
    Queue.body(".", { number: 900, title: "T1: a title", body: text }).pipe(
      Effect.provide(memory({ more: { body: text } }).layer),
    );

  // Plants: leave the sections check out of `body`, so `land.ts check` and `queue` both pass the placeholder; name no section; point at no skill.
  it.effect.prop(
    "property: a description with the draft placeholder, or without a required section, is refused with what is missing and the pr skill; a full one passes",
    { placeholder: Schema.Boolean, left: Schema.Literals(["none", "Summary", "Evidence", "Merge Danger"]) },
    ({ placeholder, left }) =>
      Effect.gen(function* () {
        const kept = ["Summary", "Evidence", "Merge Danger"].filter((name) => name !== left);
        const text = `${placeholder ? `${Sections.DRAFT_BODY}\n\n` : ""}${kept.map((name) => `## ${name}\n\nWords.\n`).join("\n")}`;
        const said = yield* answer(text);

        if (!placeholder && left === "none") {
          expect(said).toBeNull();

          return;
        }

        expect(said).toContain(".agents/skills/pr/SKILL.md");
        expect(said?.includes("still the draft placeholder sentence")).toBe(placeholder);
        expect(said?.includes(`## ${left}`)).toBe(left !== "none");
      }),
  );

  // Plant: check the sections in `body` only, so a queue add on the placeholder asks the merge.
  it.effect("scenario: add refuses a draft's placeholder body with the same words, and asks no merge", () =>
    Effect.gen(function* () {
      const m = memory({ more: { body: Sections.DRAFT_BODY } });
      const refused = yield* Effect.flip(add(m));

      expect(refused._tag === "NotQueued" ? refused.reason : "").toContain("still the draft placeholder sentence");
      expect(m.github.calls).toEqual([]);
    }),
  );
});

describe("body: a `fabrika close ticket <N>` line must name an open tracker ticket, so the merge closes it (a merge closes only the tickets its pull request names with our own phrase)", () => {
  /** What `body` answers for a description, with these open tracker tickets and open GitHub issues. */
  const checked = (
    lines: string,
    w: { open?: ReadonlyArray<number>; issues?: ReadonlyArray<number>; failing?: World["failing"] } = {},
  ) => {
    const text = `${full}\n${lines}`;
    const m = memory({ open: w.open ?? [], more: { body: text }, ...(w.failing ? { failing: w.failing } : {}) });

    for (const n of w.issues ?? []) {
      m.github.issues.add(n);
    }

    return Queue.body(".", { number: 900, title: "T1: a title", body: text }).pipe(
      Effect.provide(m.layer),
      Effect.result,
    );
  };

  // Plants: let a line pass whose number is no open tracker ticket (the 2009 and 2004 mistake: 1843 and 1841 were GitHub issues), or name `Closes #N` in the refusal only when the issue is open.
  it.effect.prop(
    "property: each named number is accepted only when it is an open tracker ticket; any other is refused by name, and says `Closes #N` when it is an open GitHub issue",
    {
      tracker: Schema.Boolean,
      issue: Schema.Boolean,
    },
    ({ tracker, issue }) =>
      Effect.gen(function* () {
        const got = yield* checked("fabrika close ticket 1843\n", {
          open: tracker ? [1843] : [5],
          issues: issue ? [1843] : [],
        });

        if (tracker) {
          expect(got).toMatchObject({ _tag: "Success", success: null });

          return;
        }

        const said = got._tag === "Success" ? String(got.success) : "";
        expect(said).toContain("fabrika close ticket 1843: 1843 is ");
        expect(said.includes("an open GitHub issue, not a tracker ticket; close it with a line `Closes #1843`")).toBe(
          issue,
        );
        expect(said.includes("is not an open tracker ticket (closed, or no such ticket)")).toBe(!issue);
      }),
  );

  it.effect(
    "scenario: a body with no close line never reads the tracker or the issues; each bad line is named once",
    () =>
      Effect.gen(function* () {
        const m = memory({ open: [7] });

        const plain = yield* Queue.body(".", {
          number: 900,
          title: "t",
          body: `${full}\nCloses #1843\nfabrika close ticket 5x`,
        }).pipe(Effect.provide(m.layer));

        expect(plain).toBeNull();
        expect(m.tracker.posts).toEqual([]);

        const two = yield* checked("fabrika close ticket 7\nfabrika close ticket 1843\nfabrika close ticket 99\n", {
          open: [7],
          issues: [1843],
        });

        const said = two._tag === "Success" ? String(two.success) : "";
        expect(said).toContain("fabrika close ticket 1843: 1843 is an open GitHub issue");
        expect(said).toContain("fabrika close ticket 99: 99 is not an open tracker ticket");
        expect(said).not.toContain("fabrika close ticket 7:");
      }),
  );

  // Plant: pass the body when the tracker cannot be read, or when the issue list cannot.
  it.effect("scenario: an unreadable tracker refuses the body, and an unreadable issue list fails the check", () =>
    Effect.gen(function* () {
      const text = "fabrika close ticket 5\n";
      const dark = yield* checked(text, { failing: { tickets: { open: "tracker offline" } } });
      expect(dark._tag === "Success" ? String(dark.success) : "").toContain("cannot read the tracker");
      const noIssues = yield* checked(text, { open: [], failing: { prs: { openIssues: "gh: offline" } } });
      expect(noIssues._tag).toBe("Failure");
    }),
  );

  // Plant: check the body in `add` only, so `land.ts check` passes a body that `queue` refuses.
  it.effect("scenario: add refuses such a body with the same words, and asks no merge", () =>
    Effect.gen(function* () {
      const m = memory({ more: { body: `${full}\nfabrika close ticket 1843\n` } });
      m.github.issues.add(1843);
      const refused = yield* Effect.flip(add(m));
      expect(refused).toMatchObject({ _tag: "NotQueued" });
      expect(refused._tag === "NotQueued" ? refused.reason : "").toContain("close it with a line `Closes #1843`");
      expect(m.github.calls).toEqual([]);
    }),
  );
});

describe("settle: a merged pull request closes the tickets it names (a merge closes only the tickets its pull request names with our own phrase, T410)", () => {
  const phrase = /^[ \t]*fabrika close ticket [0-9]+[ \t]*$/;
  const note = `Closed by the merge of https://github.com/${repo}/pull/900, merge commit ${merged}.\n`;

  const landed = (body: string, w: World = {}) =>
    memory({ state: "MERGED", ...w, more: { body, mergeCommit: merged, ...w.more } });

  const closes = (m: ReturnType<typeof memory>) => m.tracker.posts.filter((p) => p._tag !== "list");

  const Noise = Schema.Array(
    Schema.Literals(["", "Done.", "close ticket 5", "fabrika close ticket", "ticket 5", "#5"]),
  );

  // Plant: match the phrase anywhere on a line, or close a ticket the description does not name.
  it.effect.prop("T410 property: a description with no phrase line closes nothing", { rows: Noise }, ({ rows }) =>
    Effect.gen(function* () {
      expect(rows.some((row) => phrase.test(row))).toBe(false);
      const m = landed(rows.join("\n"), { open: [5, 520] });
      const done = yield* settle(m);
      expect(m.tracker.posts).toEqual([]);
      expect(done.lines).toContain("pr 900: no fabrika close ticket line; closed no tickets");
    }),
  );

  // Plant: read GitHub's closing keywords, or a ticket trailer, as a close.
  it.effect(
    "T410 vector: GitHub's nine closing keywords and ticket trailers close nothing (GitHub docs, linking a pull request to an issue)",
    () =>
      Effect.gen(function* () {
        const keywords = ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"];

        const body = [
          ...keywords.flatMap((k) => [`${k} #5`, `${k.slice(0, 1).toUpperCase()}${k.slice(1)} #5`, `${k}: 5`]),
          "Ticket: 5",
          "Closes-ticket: 5",
          "T5 build: the fix",
        ].join("\n");

        const m = landed(body, { open: [5] });
        yield* settle(m);
        expect(m.tracker.posts).toEqual([]);
      }),
  );

  // Plant: accept the phrase with other text before or after it on the line.
  it.effect.prop(
    "T410 property: the phrase inside other text on its line closes nothing",
    { other: Schema.Literals(["-", "*", ">", "`", "#", "x.", "a:"]), before: Schema.Boolean },
    ({ other, before }) =>
      Effect.gen(function* () {
        const row = before ? `${other} fabrika close ticket 5` : `fabrika close ticket 5${other}`;
        const m = landed(`Done.\n${row}\n`, { open: [5] });
        yield* settle(m);
        expect(m.tracker.posts).toEqual([]);
      }),
  );

  // Plant: close only the first line's ticket, skip the comment, or close one already closed.
  it.effect.prop(
    "T410 property: each phrase line closes its open ticket once, with a comment naming the PR and the merge commit",
    {
      named: Schema.Literals([[7], [7, 410], [999, 3, 41]]),
      open: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean]),
      lead: Schema.Literals(["", " ", "\t", "  "]),
      trail: Schema.Literals(["", " ", "\t", "  "]),
      crlf: Schema.Boolean,
    },
    ({ named, open, lead, trail, crlf }) =>
      Effect.gen(function* () {
        // SAFETY: `indexOf` only compares: a number that is not in `named` answers -1.
        const isOpen = (n: number) => open[named.indexOf(n as never)] === true;

        // A repeated line closes its ticket once.
        const rows = [
          "Done.",
          ...named.map((n) => `${lead}fabrika close ticket ${n}${trail}`),
          `fabrika close ticket ${named[0]}`,
        ];

        const m = landed(rows.join(crlf ? "\r\n" : "\n"), { open: named.filter(isOpen) });
        const done = yield* settle(m);
        expect(m.tracker.posts[0]).toEqual({ _tag: "list" });
        expect(closes(m)).toEqual(
          named.flatMap((n) =>
            isOpen(n)
              ? [
                  { _tag: "comment", ticket: n, body: note },
                  { _tag: "close", ticket: n },
                ]
              : [],
          ),
        );

        for (const n of named) {
          expect(done.lines).toContain(
            isOpen(n)
              ? `pr 900: closed ticket ${n}`
              : `pr 900: ticket ${n} is not open (already closed, or no such ticket); left as it is`,
          );
        }
      }),
  );

  // Plant: stop after the first ticket.
  it.effect("T410 scenario: two phrase lines close two tickets (the decision's own example)", () =>
    Effect.gen(function* () {
      const m = landed("Builds the close.\n\nfabrika close ticket 410\nfabrika close ticket 411\n", {
        open: [410, 411],
      });

      const done = yield* settle(m);
      expect(closes(m).map((p) => [p._tag, "ticket" in p ? p.ticket : null])).toEqual([
        ["comment", 410],
        ["close", 410],
        ["comment", 411],
        ["close", 411],
      ]);
      expect(done).toMatchObject({ _tag: "merged", commit: merged });
      expect(done.lines).toEqual([
        `pr 900: merged at ${merged}`,
        "pr 900: closed ticket 410",
        "pr 900: closed ticket 411",
      ]);
    }),
  );

  // Plant: close when GitHub does not say MERGED, when it names no merge commit, or when the pull
  // request merged into a branch that is not main.
  it.effect.prop(
    "T410 property: a pull request that is open, closed, a draft, unconfirmed or merged off main closes nothing and starts no sweep",
    {
      world: Schema.Literals([
        { state: "OPEN", draft: false, base: "main", commit: null },
        { state: "OPEN", draft: true, base: "main", commit: null },
        { state: "CLOSED", draft: false, base: "main", commit: null },
        { state: "MERGED", draft: false, base: "main", commit: null },
        { state: "MERGED", draft: false, base: "fabrikalfa/parent", commit: merged },
      ]),
    },
    ({ world }) =>
      Effect.gen(function* () {
        const m = memory({
          state: world.state,
          draft: world.draft,
          more: { body: "fabrika close ticket 5", base: world.base, mergeCommit: world.commit },
          open: [5],
        });

        const done = yield* settle(m);
        expect(done._tag).toBe("unmerged");
        expect(done.lines).toHaveLength(1);
        expect(done.lines[0]).toMatch(/^pr 900: .*; closed no tickets$/);
        expect(m.tracker.posts).toEqual([]);
        expect(m.sweeps.kicks).toBe(0);
      }),
  );

  // Plants: let tracker or sweep trouble fail the settle; close a ticket whose comment failed.
  it.effect.prop(
    "property: after a merge one sweep is started, and trouble with the tracker or the sweep is a line, never a failure",
    { failing: Schema.Literals(["none", "open", "comment", "close", "sweep"]) },
    ({ failing }) =>
      Effect.gen(function* () {
        const tickets =
          failing === "open" || failing === "comment" || failing === "close" ? { [failing]: "ERROR refused" } : {};

        const m = landed("fabrika close ticket 5", {
          open: [5],
          failing: { tickets, ...(failing === "sweep" ? { sweep: "no node" } : {}) },
        });

        const done = yield* settle(m);
        expect(done._tag).toBe("merged");
        expect(m.sweeps.kicks).toBe(1);
        expect(closes(m).map((p) => p._tag)).toEqual(
          Match.value(failing).pipe(
            Match.when("open", () => []),
            Match.when("comment", () => ["comment"]),
            Match.orElse(() => ["comment", "close"]),
          ),
        );
        expect(done.lines.slice(1)).toEqual(
          {
            none: ["pr 900: closed ticket 5"],
            open: ["pr 900: cannot read the tracker; closed no tickets: 5"],
            comment: ["pr 900: ticket 5 not closed, the comment failed: ERROR refused"],
            close: ["pr 900: ticket 5 not closed: ERROR refused"],
            sweep: ["pr 900: closed ticket 5", "pr 900: box cleanup not started: no node"],
          }[failing],
        );
      }),
  );
});

describe("closeOnly: closes the named tickets and starts no sweep (a merge closes only the tickets its pull request names with our own phrase)", () => {
  const body = "Done.\nfabrika close ticket 5\n";
  const run = (m: ReturnType<typeof memory>) => Queue.closeOnly({ repo, pr: 900 }).pipe(Effect.provide(m.layer));

  // Plants: kick a sweep; close from a pull request that is open, closed, unconfirmed or merged
  // off main; close a ticket that is not open.
  it.effect.prop(
    "property: only a pull request confirmed merged into main closes its named open ticket, and no world starts a sweep",
    {
      state: State,
      draft: Schema.Boolean,
      base: Schema.Literals(["main", "fabrikalfa/parent"]),
      confirmed: Schema.Boolean,
      open: Schema.Boolean,
    },
    ({ state, draft, base, confirmed, open }) =>
      Effect.gen(function* () {
        const m = memory({
          state,
          draft,
          open: open ? [5] : [],
          more: { body, base, mergeCommit: confirmed ? merged : null },
        });

        const done = yield* run(m);
        const lands = state === "MERGED" && confirmed && base === "main";
        expect(done._tag).toBe(lands ? "merged" : "unmerged");
        expect(m.tracker.posts.filter((p) => p._tag !== "list").map((p) => p._tag)).toEqual(
          lands && open ? ["comment", "close"] : [],
        );
        expect(done.lines.includes("pr 900: closed ticket 5")).toBe(lands && open);
        expect(m.sweeps.kicks).toBe(0);
      }),
  );
});

describe("the tracker's command line, as TicketsCli reads it", () => {
  // format: `cli.ts post list` prints one line per open ticket, `<home>: #<n> <state> <title>`.
  it("format: only a line that names an open ticket counts, and a failure keeps the first ERROR line, never the stack", () => {
    const listed = ["home: #12 open Fix the door", "home: #13 closed Old", "posted", "home: #140 open #12 open again"];
    expect(TicketsCli.openIn(listed.join("\n"))).toEqual([12, 140]);
    expect(TicketsCli.firstError("  at file.ts:1\nERROR no such ticket\nERROR second")).toBe("ERROR no such ticket");
    expect(TicketsCli.firstError("  at file.ts:1")).toBe("no reason given");
  });
});
