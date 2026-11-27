// Today's lead tooling. Publish's laws (every commit is pushed when it is made, with a draft pull request from the first commit) on the test layers: nothing here pushes or asks GitHub.
import { describe, expect, it } from "@effect/vitest";
import { Recorder } from "@kampus/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Publish from "./Publish.ts";
import type { PullRequest } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import { LeakGrepRefused, Pushes, PushRefused } from "./Pushes.ts";
import * as PushesProcess from "./PushesProcess.ts";
import * as PushesTest from "./PushesTest.ts";
import * as Sections from "./Sections.ts";

/** Branch names of every kind the commit step meets: the bot's, a quest's backup, a person's, a bare one. */
const Branch = Schema.Literals(["fabrikalfa/a", "fabrikalfa/quest-wip", "person/b", "c"]);

const Sha = Schema.Literals(["1".repeat(40), "2".repeat(40), "a".repeat(40)]);

/** No PR on the branch yet, an open draft, or an open ready one. */
const Already = Schema.NullOr(Schema.Boolean);

const text = { title: "T1 tests: a law", body: Sections.DRAFT_BODY };

const open = (number: number, head: string, draft: boolean): PullRequest => ({
  number,
  head,
  oid: "",
  state: "OPEN",
  draft,
});

/** Fresh memory for one run: the remote, GitHub, and the layer over both. */
const memory = (
  prs: ReadonlyArray<PullRequest> = [],
  failing: { pushes?: PushesTest.Failing; prs?: PullRequestsTest.Failing } = {},
) => {
  const remote = PushesTest.remote();
  const github = PullRequestsTest.world(prs);
  const layer = Layer.mergeAll(PushesTest.layer(remote, failing.pushes), PullRequestsTest.layer(github, failing.prs));

  return { remote, github, layer };
};

const ask = (branch: string, head: string): Publish.Ask => ({
  dir: ".",
  branch,
  source: Publish.Source.cases.commit.make({ sha: head }),
  text,
});

describe("publish: a commit is pushed when it is made, with a draft PR from the first commit", () => {
  it.effect.prop(
    "property: the leak grep runs first, the head reaches its branch, and a draft opens only when none is open",
    { b: Branch, head: Sha, already: Already },
    ({ b, head, already }) => {
      const m = memory(already === null ? [] : [open(7, b, already)]);

      return Effect.gen(function* () {
        yield* Publish.publish(ask(b, head));
        expect(yield* Recorder.calls(Pushes)).toEqual([
          { method: "leakGrep", args: [".", head] },
          { method: "push", args: [".", b, head] },
        ]);
        expect(m.remote.branches.get(b)).toBe(head);
        expect(m.github.prs.filter((pr) => pr.head === b && pr.state === "OPEN")).toHaveLength(1);
        expect(m.github.calls).toEqual(already === null ? [{ _tag: "draft", branch: b, ...text }] : []);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: a second commit on the branch opens no second pull request",
    { b: Branch, first: Sha, second: Sha },
    ({ b, first, second }) =>
      Effect.gen(function* () {
        const m = memory();
        const one = yield* Publish.publish(ask(b, first)).pipe(Effect.provide(m.layer));
        const two = yield* Publish.publish(ask(b, second)).pipe(Effect.provide(m.layer));
        expect(one).toEqual({ pr: 1, opened: true, draft: true });
        expect(two).toEqual({ pr: 1, opened: false, draft: true });
        expect(m.github.prs).toHaveLength(1);
        expect(m.remote.branches.get(b)).toBe(second);
      }),
  );

  it.effect.prop(
    "property: a refused leak grep pushes nothing and asks GitHub nothing",
    { b: Branch, head: Sha },
    ({ b, head }) => {
      const m = memory([], { pushes: { leakGrep: new LeakGrepRefused({ reason: "private_word" }) } });

      return Effect.gen(function* () {
        const e = yield* Effect.flip(Publish.publish(ask(b, head)));
        expect(e._tag).toBe("LeakGrepRefused");
        expect(yield* Recorder.calls(Pushes)).toEqual([{ method: "leakGrep", args: [".", head] }]);
        expect(m.remote.branches.size).toBe(0);
        expect(m.github.calls).toEqual([]);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: a refused push fails the publish and opens no pull request",
    { b: Branch, head: Sha },
    ({ b, head }) => {
      const m = memory([], { pushes: { push: new PushRefused({ reason: "rejected" }) } });

      return Effect.gen(function* () {
        const e = yield* Effect.flip(Publish.publish(ask(b, head)));
        expect(e._tag).toBe("PushRefused");
        expect(yield* Recorder.calls(Pushes)).toEqual([
          { method: "leakGrep", args: [".", head] },
          { method: "push", args: [".", b, head] },
        ]);
        expect(m.remote.branches.size).toBe(0);
        expect(m.github.prs).toEqual([]);
      }).pipe(Effect.provide(m.layer));
    },
  );

  // scenario: drive's sign worktree is detached, and no commit step ever pushes main.
  it.effect("scenario: a detached head or main is refused before any grep or push", () =>
    Effect.forEach(
      ["", "HEAD", "main", "refs/heads/main"],
      (b) =>
        Effect.gen(function* () {
          const e = yield* Effect.flip(Publish.publish(ask(b, "a".repeat(40))));
          expect(e._tag, b).toBe("NoBranch");
          expect(yield* Recorder.calls(Pushes)).toEqual([]);
        }).pipe(Effect.provide(memory().layer)),
      { concurrency: 1 },
    ),
  );

  // scenario: a helper ran publish.ts from main's checkout for a ticket branch, so main's HEAD was about to be pushed onto it.
  it.effect("scenario: a checkout on another branch is refused, naming both, with nothing pushed", () => {
    const m = memory();

    return Effect.gen(function* () {
      const e = yield* Effect.flip(
        Publish.publish({
          ...ask("fabrikalfa/a", "a".repeat(40)),
          source: Publish.Source.cases.checkout.make({ head: "a".repeat(40), checkedOut: "main" }),
        }),
      );

      expect(e._tag).toBe("NoBranch");
      expect(e.reason).toContain("main");
      expect(e.reason).toContain("fabrikalfa/a");
      expect(e.reason).toContain("git worktree list");
      expect(yield* Recorder.calls(Pushes)).toEqual([]);
      expect(m.remote.branches.has("fabrikalfa/a")).toBe(false);
      expect(m.github.prs).toEqual([]);
    }).pipe(Effect.provide(m.layer));
  });

  // scenario: a named commit pushes with no checkout in question (drive's box runs in main's checkout).
  it.effect("scenario: an exact commit publishes to any branch, whatever checkout it is asked from", () => {
    const m = memory();
    const sha = "b".repeat(40);

    return Effect.gen(function* () {
      yield* Publish.publish({ ...ask("fabrikalfa/a", sha), source: Publish.Source.cases.commit.make({ sha }) });
      expect(m.remote.branches.get("fabrikalfa/a")).toBe(sha);
    }).pipe(Effect.provide(m.layer));
  });

  // scenario: the checkout is on the branch, so it publishes as before.
  it.effect("scenario: a checkout on the branch publishes", () => {
    const m = memory();
    const head = "a".repeat(40);

    return Effect.gen(function* () {
      const p = yield* Publish.publish({
        ...ask("fabrikalfa/a", head),
        source: Publish.Source.cases.checkout.make({ head, checkedOut: "fabrikalfa/a" }),
      });

      expect(p).toEqual({ pr: 1, opened: true, draft: true });
      expect(m.remote.branches.get("fabrikalfa/a")).toBe(head);
    }).pipe(Effect.provide(m.layer));
  });

  // scenario: the push and the draft are two calls; a refused draft must not read as a pass.
  it.effect("scenario: GitHub refusing the draft fails the publish after the push, so the commit is on GitHub", () =>
    Effect.gen(function* () {
      const m = memory([], { prs: { draft: "422" } });
      const e = yield* Effect.flip(Publish.publish(ask("fabrikalfa/x", "b".repeat(40))).pipe(Effect.provide(m.layer)));
      expect(e._tag).toBe("PullRequestsError");
      expect(m.remote.branches.get("fabrikalfa/x")).toBe("b".repeat(40));
    }),
  );
});

describe("publish.ts's words: a new draft takes the title and body it is given", () => {
  const Title = Schema.Literals(["Say what changes", "T7 build: a law", "x"]);
  const File = Schema.Literals(["body.md", "/tmp/pr body.md", "a/b/c.md"]);

  // Plant: read only the first flag, or drop the flags' order.
  it.prop(
    "property: the branch, a title and a body file are read in whichever order and whichever of them are given",
    { b: Branch, title: Schema.NullOr(Title), file: Schema.NullOr(File), order: Schema.Literals(["bf", "fb"]) },
    ({ b, title, file, order }) => {
      const flags = [...(title === null ? [] : ["--title", title]), ...(file === null ? [] : ["--body-file", file])];
      const args = order === "bf" ? [b, ...flags] : [...flags, b];

      expect(Publish.words(args)).toEqual({ branch: b, title, bodyFile: file });
    },
  );

  // Plant: accept a flag twice, an unknown flag, a flag with no value, two branches or none.
  it("vector: anything but one branch and each flag at most once, with a value, is no words", () => {
    for (const args of [
      [],
      ["--title", "T"],
      ["a", "b"],
      ["a", "--title"],
      ["a", "--title", ""],
      ["a", "--title", "--body-file", "f"],
      ["a", "--title", "T", "--title", "U"],
      ["a", "--body-file", "f", "--body-file", "g"],
      ["a", "--body", "f"],
      ["a", "--force"],
    ]) {
      expect(Publish.words(args), args.join(" ")).toBeNull();
    }
  });

  // Plant: ignore the given title or body, or use the given words for a pull request already open.
  it.effect.prop(
    "property: a new draft opens with the given title and body, else the commit's subject and the placeholder",
    {
      b: Branch,
      head: Sha,
      title: Schema.NullOr(Title),
      body: Schema.NullOr(Schema.Literals(["Why this", "## Summary\n\nWhat"])),
    },
    ({ b, head, title, body }) => {
      const m = memory();
      const given = Publish.draftText("the subject", { branch: b, title, bodyFile: body === null ? null : "f" }, body);

      return Effect.gen(function* () {
        yield* Publish.publish({ ...ask(b, head), text: given });
        expect(m.github.calls).toEqual([
          { _tag: "draft", branch: b, title: title ?? "the subject", body: body ?? Sections.DRAFT_BODY },
        ]);
      }).pipe(Effect.provide(m.layer));
    },
  );

  it.effect.prop(
    "property: a pull request already open keeps its own words",
    { b: Branch, head: Sha },
    ({ b, head }) => {
      const m = memory([open(7, b, true)]);

      return Effect.gen(function* () {
        yield* Publish.publish({ ...ask(b, head), text: { title: "new", body: "new body" } });
        expect(m.github.calls).toEqual([]);
      }).pipe(Effect.provide(m.layer));
    },
  );
});

describe("publish.ts with --title or --body-file on an open pull request (gh pr edit fails here, so helpers patched by hand twice)", () => {
  const Given = Schema.Struct({
    title: Schema.NullOr(Schema.Literals(["New title", "T9 fix: x"])),
    body: Schema.NullOr(Schema.Literals(["New body", "## Summary\n\nWhy"])),
  });

  // Plants: edit only when both are given, set the other part to a placeholder or to nothing, change the draft state, or leave the open pull request's words alone.
  it.effect.prop(
    "property: an open pull request takes the given title and body, keeps a part not given, and stays a draft or ready as it was",
    { b: Branch, head: Sha, draft: Schema.Boolean, given: Given },
    ({ b, head, draft, given }) => {
      const m = memory([open(7, b, draft)]);
      m.github.more.set(7, { title: "Old title", body: "Old body" });
      const some = given.title !== null || given.body !== null;

      return Effect.gen(function* () {
        const done = yield* Publish.publish({
          ...ask(b, head),
          given: {
            ...(given.title === null ? {} : { title: given.title }),
            ...(given.body === null ? {} : { body: given.body }),
          },
        });

        expect(m.github.calls).toEqual(
          some ? [{ _tag: "edit", number: 7, title: given.title ?? "Old title", body: given.body ?? "Old body" }] : [],
        );
        expect(m.github.prs.find((p) => p.number === 7)?.draft).toBe(draft);
        expect(done.edited === true).toBe(some);
        expect(Publish.line(b, done)).toBe(
          some
            ? `pushed ${b}; PR 7 was already open, and its title and body are updated`
            : `pushed ${b}; PR 7 was already open`,
        );
      }).pipe(Effect.provide(m.layer));
    },
  );

  // Plant: send the given words to GitHub before the leak grep, or skip it for them.
  it.effect(
    "scenario: given words are leak-grepped before anything is pushed or edited; a refusal changes nothing",
    () => {
      const m = memory([open(7, "fabrikalfa/a", true)], {
        pushes: { leakText: new LeakGrepRefused({ reason: "private_word" }) },
      });

      return Effect.gen(function* () {
        const e = yield* Effect.flip(
          Publish.publish({ ...ask("fabrikalfa/a", "1".repeat(40)), given: { title: "t", body: "b" } }),
        );

        expect(e._tag).toBe("LeakGrepRefused");
        expect(m.remote.branches.size).toBe(0);
        expect(m.github.calls).toEqual([]);
      }).pipe(Effect.provide(m.layer));
    },
  );
});

describe("ready: a quest's steps passed, so its pull request takes the brief's words and is ready (every commit is pushed when it is made, with a draft pull request from the first commit)", () => {
  it.effect.prop(
    "property: the PR gets the brief's text, a draft is marked ready, a ready one is left as it is",
    { b: Branch, head: Sha, already: Already },
    ({ b, head, already }) =>
      Effect.gen(function* () {
        const m = memory(already === null ? [] : [open(7, b, already)]);
        yield* Publish.ready(ask(b, head)).pipe(Effect.provide(m.layer));
        const pr = already === null ? 1 : 7;
        const readied = already === false ? [] : [{ _tag: "ready", number: pr }];
        const opened = already === null ? [{ _tag: "draft", branch: b, ...text }] : [];
        expect(m.github.calls).toEqual([...opened, { _tag: "edit", number: pr, ...text }, ...readied]);
        expect(m.github.prs.find((p) => p.number === pr)?.draft).toBe(false);
      }),
  );
});

describe("the process layers' own reads", () => {
  // vector: the URL shapes `git remote get-url` prints for GitHub, and two that are not GitHub.
  it("vector: an origin URL GitHub serves gives owner/name; any other gives none", () => {
    expect(PullRequestsGh.repoFromUrl("https://github.com/o/r.git\n")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("https://github.com/o/r")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("git@github.com:o/r.git")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("ssh://git@github.com/o/r.git")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("https://gitlab.com/o/r.git")).toBeNull();
    expect(PullRequestsGh.repoFromUrl("/srv/git/r.git")).toBeNull();
  });

  it.prop(
    "property: only a fabrikalfa/ branch is the bot's to push; any other is pushed on the person's login",
    { b: Branch },
    ({ b }) => PushesProcess.isBotBranch(b) === b.startsWith("fabrikalfa/"),
  );
});
