// Today's lead tooling. The Reviews service on `gh` (./ReviewsGh.ts): the reader asks for one full head's statuses, every page, and keeps
// only those of context `review` (R5); the writer posts the comment and then the status, in that order, and posts no status for a comment
// that failed (R6). `gh` is a stand-in that answers as told and keeps every call: nothing here asks GitHub.
import { describe, expect, it } from "@effect/vitest";
import { Recorder, runsFor } from "@kampus/vitest";
import { Effect, Layer, Option, Result, Schema, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Review from "./Review.ts";
import { Reviews } from "./Reviews.ts";
import * as ReviewsGh from "./ReviewsGh.ts";
import * as Statuses from "./ReviewStatus.fixture.ts";

const hex = (n: number): string => `${n.toString(16).padStart(2, "0")}ab`.repeat(20).slice(0, 40);

type Said = { readonly code: number; readonly out: string };

const handle = ({ code, out }: Said) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.die("fixture never signals a process"),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(out)),
    stderr: Stream.make(new TextEncoder().encode(code === 0 ? "" : "gh: HTTP 403\n")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** `gh`, as a stand-in: each call is answered from its own arguments, and kept in order. */
const layers = (answer: (args: ReadonlyArray<string>) => Said) => {
  const spawner = Recorder.layer(ChildProcessSpawner.ChildProcessSpawner, {
    spawn: (command) =>
      Effect.succeed(handle(answer(ChildProcess.isStandardCommand(command) ? command.args.map(String) : []))),
  });

  return Layer.merge(spawner, ReviewsGh.layer("owner/repo", ".").pipe(Layer.provide(spawner)));
};

/** Every call `gh` was asked, as `gh` and its arguments. */
const asked = Effect.map(Recorder.calls(ChildProcessSpawner.ChildProcessSpawner, "spawn"), (calls) =>
  calls.map(([command]) =>
    ChildProcess.isStandardCommand(command) ? [command.command, ...command.args.map(String)] : ["not a command"],
  ),
);

// ---------------------------------------------------------------------------------------------------------
// R5: the reader
// ---------------------------------------------------------------------------------------------------------

const CONTEXTS = [
  "review",
  "review",
  "review",
  "ci-required",
  "Review",
  "review-x",
  "review ",
  "reviews",
  "x/review",
  "",
] as const;

const Row = Schema.Struct({
  id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 })),
  context: Schema.Literals(CONTEXTS),
  state: Schema.Literals(["success", "failure", "error", "pending"]),
  said: Schema.Literals(["pass", "override", "garbage", "none"]),
  creator: Schema.NullOr(Schema.Literals(["lead", "a-bot[bot]", "someone"])),
  url: Schema.Boolean,
});

const Answer = Schema.Struct({
  rows: Schema.Array(Row).check(Schema.isMaxLength(8)),
  pages: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
  sha: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
});

/** The rows with ids made distinct, and what each says as GitHub gives it: the keys we read, and keys we never read. */
const given = (rows: (typeof Answer.Type)["rows"]) =>
  rows.map((r, i) => {
    const id = r.id * 10 + i;

    return {
      r,
      id,
      json: {
        url: `https://api.github.com/repos/owner/repo/statuses/${hex(1)}`,
        id,
        node_id: `SC_${id}`,
        state: r.state,
        description:
          r.said === "pass"
            ? `pass v1 reviewed=${hex(id)} patch=${hex(id + 1)}`
            : r.said === "override"
              ? "override v1 sev1 fix"
              : r.said === "garbage"
                ? "something else"
                : null,
        target_url: r.url ? `https://github.com/owner/repo/pull/7#issuecomment-${id}` : null,
        context: r.context,
        created_at: "2026-11-26T17:50:46Z",
        creator: r.creator === null ? null : { login: r.creator, id: 1, type: "Bot" },
      },
    };
  });

const slurped = (rows: ReadonlyArray<{ readonly json: unknown }>, pages: number): string => {
  const size = Math.max(1, Math.ceil(rows.length / pages));
  const out: Array<ReadonlyArray<unknown>> = [];

  for (let i = 0; i < Math.max(rows.length, 1); i += size) {
    out.push(rows.slice(i, i + size).map((x) => x.json));
  }

  return JSON.stringify(rows.length === 0 ? [[]] : out);
};

describe("R5: the reader (slice 1)", () => {
  // Plants, each run once and restored: match the context by prefix or case; pass a branch name through; turn a failed `gh` exit into no
  // statuses; read the creator from the wrong key; list the statuses newest first.
  it.effect.prop(
    "R5 property: the reader asks `gh` once for the statuses of the full head, every page, and gives back, oldest first, only the statuses whose context is exactly `review`, each with its id, creator, state, what it says and its url",
    Answer.fields,
    ({ rows, pages, sha }) =>
      Effect.gen(function* () {
        const head = hex(sha);
        const all = given(rows);
        const reviews = yield* Reviews;
        const seen = yield* reviews.read(head);

        const kept = all.filter((x) => x.r.context === "review").toSorted((a, b) => a.id - b.id);

        expect(seen.map((s) => s.id)).toEqual(kept.map((x) => x.id));
        expect(seen.map((s) => s.creator)).toEqual(kept.map((x) => x.r.creator ?? ""));
        expect(seen.map((s) => s.state)).toEqual(kept.map((x) => x.r.state));
        expect(seen.map((s) => s.url)).toEqual(kept.map((x) => x.json.target_url));

        expect(seen.map((s) => Result.isSuccess(s.core))).toEqual(
          kept.map((x) =>
            x.r.said === "pass" ? x.r.state === "success" : x.r.said === "override" && x.r.state === "failure",
          ),
        );

        expect(yield* asked).toEqual([
          ["gh", "api", "--paginate", "--slurp", `repos/owner/repo/commits/${head}/statuses?per_page=100`],
        ]);
      }).pipe(
        // The stand-in serves the rows, newest first, as GitHub lists them.
        Effect.provide(layers(() => ({ code: 0, out: slurped(given(rows).toReversed(), pages) }))),
      ),
    { arbitrary: { seed: 1006, runs: runsFor({ fast: 200, full: 400 }) } },
  );

  it.effect.prop(
    "R5 property: a head that is not 40 lowercase hex characters is refused before any call, and a `gh` that fails, or answers a shape we do not read, is an error and never no statuses",
    {
      head: Schema.Literals([
        "main",
        "fabrikalfa/x",
        "abcdef0",
        hex(3).toUpperCase(),
        hex(3).slice(1),
        `${hex(3)}0`,
        ` ${hex(3)}`,
        `${hex(3)}\n`,
        "",
      ]),
      code: Schema.Literals([0, 1, 2, 4]),
      out: Schema.Literals(["", "not json", "{}", '[{"id":1}]', '[[{"id":"x"}]]']),
    },
    ({ head, code, out }) =>
      Effect.gen(function* () {
        const reviews = yield* Reviews;
        const badHead = yield* Effect.flip(reviews.read(head));
        expect(badHead._tag).toBe("ReviewsError");
        expect(yield* asked).toEqual([]);

        const full = hex(4);
        const result = yield* Effect.result(reviews.read(full));
        expect(Result.isFailure(result)).toBe(true);
        expect((yield* asked).length).toBe(1);
        expect(code).toBeGreaterThanOrEqual(0);
      }).pipe(Effect.provide(layers(() => ({ code, out })))),
    { arbitrary: { seed: 1007, runs: runsFor({ fast: 60, full: 200 }) } },
  );

  // Recorded 2026-11-27 with `gh api repos/jenkinsci/jenkins/commits/4efc98808a27aa585c89d57eef93c069df4ddde7/statuses`: the six statuses one
  // public pull request's head held, as GitHub gave them, wrapped in the one more array `--slurp` makes of its pages. This repository's own
  // pull requests hold no commit status, so this answer is from another public repository and its context is not ours: the reader keeps the
  // rows of context `review`, so the shape is read here through `decode`, which keeps every context. The lead's live proof run supplies a
  // real status of context `review`.
  const VECTOR =
    '[[{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59892202675,"node_id":"SC_kwDOABDW988AAAAN8dp8sw","state":"pending","description":"This commit is being built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/1/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:53:55Z","updated_at":"2026-11-25T16:53:55Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}},{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59892092966,"node_id":"SC_kwDOABDW988AAAAN8djQJg","state":"pending","description":"This commit is being built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/1/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:52:47Z","updated_at":"2026-11-25T16:52:47Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}},{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59892055772,"node_id":"SC_kwDOABDW988AAAAN8dg-3A","state":"pending","description":"This commit is being built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/1/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:52:24Z","updated_at":"2026-11-25T16:52:24Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}},{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59891850147,"node_id":"SC_kwDOABDW988AAAAN8dUbow","state":"pending","description":"This commit is being built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/1/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:50:16Z","updated_at":"2026-11-25T16:50:16Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}},{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59891606218,"node_id":"SC_kwDOABDW988AAAAN8dFiyg","state":"pending","description":"This commit is being built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/1/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:47:43Z","updated_at":"2026-11-25T16:47:43Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}},{"url":"https://api.github.com/repos/jenkinsci/jenkins/statuses/4efc98808a27aa585c89d57eef93c069df4ddde7","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","id":59891397978,"node_id":"SC_kwDOABDW988AAAAN8c41Wg","state":"pending","description":"This commit is scheduled to be built","target_url":"https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/display/redirect","context":"continuous-integration/jenkins/pr-head","created_at":"2026-11-25T16:45:34Z","updated_at":"2026-11-25T16:45:34Z","creator":{"login":"ci-jenkins-io[bot]","id":68988873,"node_id":"MDM6Qm90Njg5ODg4NzM=","avatar_url":"https://avatars.githubusercontent.com/in/74951?v=4","gravatar_id":"","url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D","html_url":"https://github.com/apps/ci-jenkins-io","followers_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/followers","following_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/following{/other_user}","gists_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/gists{/gist_id}","starred_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/starred{/owner}{/repo}","subscriptions_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/subscriptions","organizations_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/orgs","repos_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/repos","events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/events{/privacy}","received_events_url":"https://api.github.com/users/ci-jenkins-io%5Bbot%5D/received_events","type":"Bot","user_view_type":"public","site_admin":false}}]]';

  // Plant: read the creator from the wrong key.
  it.effect(
    "vector: a real GET commits/<sha>/statuses answer reads as its six statuses, with each id, state, creator login and url",
    () =>
      Effect.gen(function* () {
        const rows = yield* ReviewsGh.decode(VECTOR);

        expect(rows.map((r) => r.seen.id)).toEqual([
          59892202675, 59892092966, 59892055772, 59891850147, 59891606218, 59891397978,
        ]);
        expect(rows.map((r) => r.context)).toEqual(
          Array.from({ length: 6 }, () => "continuous-integration/jenkins/pr-head"),
        );
        expect(rows.map((r) => r.seen.creator)).toEqual(Array.from({ length: 6 }, () => "ci-jenkins-io[bot]"));
        expect(rows.map((r) => r.seen.state)).toEqual(Array.from({ length: 6 }, () => "pending"));

        expect(rows[5]?.seen.url).toBe("https://ci.jenkins.io/job/Core/job/jenkins/job/PR-27900/display/redirect");
        expect(rows.every((r) => Result.isFailure(r.seen.core))).toBe(true);
      }),
  );
});

// Recorded 2026-11-27 from this repository's own pull request, in the lead's live proof of slice 1 (./ReviewStatus.fixture.ts says how, and what was
// replaced): a fresh record's status and a carry's.
describe("R5: the reader on this repository's own recorded statuses (slice 2)", () => {
  // Plants, each run once and restored: read the creator from the wrong key; read the description from `title`; match the context by prefix; let
  // a carry read as something other than the pass it carries.
  it.effect(
    "vector: a real fresh record and a real carry, as GitHub lists them, read as one and the same approval: the same reviewed head, patch id and comment, on two different heads",
    () =>
      Effect.gen(function* () {
        const reads = [];

        for (const text of [Statuses.PASS, Statuses.CARRY]) {
          const [row] = yield* ReviewsGh.decode(text);
          const head = /statuses\/([0-9a-f]{40})$/.exec(JSON.parse(text)[0][0].url)?.[1] ?? "";

          // The reader asks for the head's statuses and is given the recorded answer.
          const [seen] = yield* Effect.flatMap(Reviews, (reviews) => reviews.read(head)).pipe(
            Effect.provide(layers(() => ({ code: 0, out: text }))),
          );

          expect(row?.context).toBe("review");
          expect(seen).toEqual(row?.seen);
          expect(seen?.state).toBe("success");
          expect(seen?.creator).toBe("the-lead-login");
          expect(seen?.url).toMatch(/^https:\/\/github\.com\/kamp-us\/tea-fabrika\/pull\/2357#issuecomment-[0-9]+$/);
          reads.push({ head, seen });
        }

        const [fresh, kept] = reads;
        expect(fresh?.head).not.toBe(kept?.head);
        expect(fresh?.seen?.id).toBeLessThan(kept?.seen?.id ?? 0);
        expect(fresh?.seen?.core).toEqual(kept?.seen?.core);
        expect(fresh?.seen?.url).toBe(kept?.seen?.url);
        expect(Result.isSuccess(fresh?.seen?.core ?? Result.fail("none"))).toBe(true);

        // What the gate does with them: either one approves a pull request that changes a reviewed path.
        for (const { seen } of reads) {
          expect(
            Review.approval({ reviewed: Review.REVIEWED, paths: ["next/a.ts"], seen: seen === undefined ? [] : [seen] })
              ._tag,
          ).toBe("approved");
        }
      }),
  );
});

// ---------------------------------------------------------------------------------------------------------
// R6: the writer
// ---------------------------------------------------------------------------------------------------------

const Write = Schema.Struct({
  tag: Schema.Literals(["pass", "carry", "override"]),
  n: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 99 })),
  pr: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 })),
  withUrl: Schema.Boolean,
  comment: Schema.Literals(["ok", "ok", "ok", "exits", "noUrl", "emptyUrl", "notJson"]),
  status: Schema.Literals(["ok", "ok", "ok", "exits"]),
});

const drawnRecord = (tag: "pass" | "carry" | "override", n: number): Review.Record => {
  const [head, reviewed, base, patchId] = [hex(n), hex(n + 100), hex(n + 200), hex(n + 300)];

  return tag === "pass"
    ? Review.Record.cases.pass.make({
        v: 1,
        head,
        reviewed,
        base,
        patchId,
        reviewer: "a reviewer, one session",
        ticket: n,
      })
    : tag === "carry"
      ? Review.Record.cases.carry.make({ v: 1, head, from: base, reviewed, patchId })
      : Review.Record.cases.override.make({ v: 1, head, reason: "sev1 fix for the red main" });
};

describe("R6: the writer (slice 1)", () => {
  // Plants, each run once and restored: post the status first; post it when the comment gave no url; swallow a failed status write; post a
  // comment for a carry; send another context.
  it.effect.prop(
    "R6 property: a write with no url posts the comment and then the status, which names the comment's url; with a url it posts the status alone, naming that url; a comment that fails or names no url posts no status; a status that fails is an error; the arguments are those of the record's encodings and nothing else",
    Write.fields,
    ({ tag, n, pr, withUrl, comment, status }) =>
      Effect.gen(function* () {
        const record = drawnRecord(tag, n);
        const given = "https://github.com/owner/repo/pull/7#issuecomment-5";
        const reviews = yield* Reviews;
        const result = yield* Effect.result(reviews.write(pr, record, withUrl ? Option.some(given) : Option.none()));
        const calls = yield* asked;
        const posted = `https://github.com/owner/repo/pull/${pr}#issuecomment-77`;
        const { state, description } = Review.status(record);

        const commentCall = [
          "gh",
          "api",
          "-X",
          "POST",
          `repos/owner/repo/issues/${pr}/comments`,
          "-f",
          `body=${Review.comment(record)}`,
        ];

        const statusCall = (url: string) => [
          "gh",
          "api",
          "-X",
          "POST",
          `repos/owner/repo/statuses/${record.head}`,
          "-f",
          `state=${state}`,
          "-f",
          "context=review",
          "-f",
          `description=${description}`,
          "-f",
          `target_url=${url}`,
        ];

        const expected = withUrl
          ? [statusCall(given)]
          : comment !== "ok"
            ? [commentCall]
            : [commentCall, statusCall(posted)];

        expect(calls).toEqual(expected);
        expect(Result.isFailure(result)).toBe(withUrl ? status === "exits" : comment !== "ok" || status === "exits");

        // A failure is one plain line, and for a refused status it names the head the status was for and the right the login may lack.
        const failure = Result.isFailure(result) ? result.failure : undefined;
        const refusedStatus = failure !== undefined && calls.length === (withUrl ? 1 : 2);
        expect(failure === undefined || failure._tag === "ReviewsError").toBe(true);
        expect(failure === undefined || !failure.reason.includes("\n")).toBe(true);
        expect(!refusedStatus || failure?.reason.includes(record.head.slice(0, 12)) === true).toBe(true);
        expect(!refusedStatus || failure?.reason.includes("right") === true).toBe(true);
      }).pipe(
        Effect.provide(
          layers((args) => {
            if (args[3]?.endsWith("/comments") === true) {
              const url = `https://github.com/owner/repo/pull/${args[3].split("/")[4] ?? ""}#issuecomment-77`;

              return comment === "exits"
                ? { code: 1, out: "" }
                : comment === "noUrl"
                  ? { code: 0, out: '{"id":77}' }
                  : comment === "emptyUrl"
                    ? { code: 0, out: '{"html_url":""}' }
                    : comment === "notJson"
                      ? { code: 0, out: url }
                      : { code: 0, out: JSON.stringify({ id: 77, html_url: url }) };
            }

            return { code: status === "exits" ? 1 : 0, out: "{}" };
          }),
        ),
      ),
    { arbitrary: { seed: 1008, runs: runsFor({ fast: 200, full: 400 }) } },
  );
});
