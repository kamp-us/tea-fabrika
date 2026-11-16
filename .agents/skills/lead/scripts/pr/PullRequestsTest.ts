import { Array as Arr } from "effect";
// PullRequestsTest.layer: the PullRequests service in memory, on one list of pull requests that its
// writes change as GitHub's would. It asks GitHub nothing. `calls` keeps every write, in order.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type Detail, type Patch, type PullRequest, PullRequests, PullRequestsError } from "./PullRequests.ts";

/** One write the layer took, as the caller made it. */
export const Call = Schema.TaggedUnion({
  draft: { branch: Schema.String, title: Schema.String },
  edit: { number: Schema.Finite, title: Schema.String, body: Schema.String },
  ready: { number: Schema.Finite },
  enqueue: { number: Schema.Finite, oid: Schema.String },
  arm: { number: Schema.Finite, oid: Schema.String },
  admin: { number: Schema.Finite, oid: Schema.String },
});

export type Call = typeof Call.Type;

/** The calls that fail with a reason, by name. */
export type Failing = Partial<
  Record<
    "openOn" | "all" | "draft" | "edit" | "ready" | "view" | "enqueue" | "files" | "patches" | "arm" | "admin",
    string
  >
>;

/** What `view` adds to a listed pull request; each part has a plain default. */
export type More = Partial<Omit<Detail, keyof PullRequest>>;

export type World = {
  readonly prs: Array<PullRequest>;
  readonly calls: Array<Call>;
  /** What `view` says beyond the list, by number: base `main`, no words and not merged when absent. */
  readonly more: Map<number, More>;
  /** The files each pull request changes, by number: none when absent. */
  readonly files: Map<number, ReadonlyArray<string>>;
  /** The diff hunks of each file a pull request changes, by number: none when absent. */
  readonly patches: Map<number, ReadonlyArray<Patch>>;
};

/** A fresh world over these pull requests; the layer reads and changes it in place. */
export const world = (prs: ReadonlyArray<PullRequest> = []): World => ({
  prs: [...prs],
  calls: [],
  more: new Map(),
  files: new Map(),
  patches: new Map(),
});

export const layer = (w: World, failing: Failing = {}): Layer.Layer<PullRequests> => {
  const fails = (name: keyof Failing) => {
    const reason = failing[name];

    return reason === undefined ? Effect.void : Effect.fail(PullRequestsError.make({ reason }));
  };

  return Layer.succeed(
    PullRequests,
    PullRequests.of({
      openOn: (branch) =>
        Effect.map(fails("openOn"), () => Arr.findFirst(w.prs, (pr) => pr.head === branch && pr.state === "OPEN")),
      all: Effect.map(fails("all"), () => [...w.prs]),
      draft: (branch, text) =>
        Effect.map(fails("draft"), () => {
          const number = Math.max(0, ...Arr.map(w.prs, (pr) => pr.number)) + 1;
          w.prs.push({ number, head: branch, oid: "", state: "OPEN", draft: true });
          w.calls.push(Call.cases.draft.make({ branch, title: text.title }));

          return number;
        }),
      edit: (number, text) =>
        Effect.map(fails("edit"), () => {
          w.calls.push(Call.cases.edit.make({ number, title: text.title, body: text.body }));
        }),
      ready: (number) =>
        Effect.map(fails("ready"), () => {
          const at = Arr.findFirstIndex(w.prs, (pr) => pr.number === number);
          const pr = Option.flatMap(at, (i) => Arr.get(w.prs, i));

          if (Option.isSome(at) && Option.isSome(pr)) {
            w.prs[at.value] = { ...pr.value, draft: false };
          }

          w.calls.push(Call.cases.ready.make({ number }));
        }),
      view: (number) =>
        Effect.flatMap(fails("view"), () => {
          const pr = Option.getOrUndefined(Arr.findFirst(w.prs, (p) => p.number === number));

          return pr === undefined
            ? Effect.fail(PullRequestsError.make({ reason: `no pull request ${number}` }))
            : Effect.succeed({
                ...pr,
                base: "main",
                title: "",
                body: "",
                mergeCommit: null,
                ...w.more.get(number),
              } satisfies Detail);
        }),
      enqueue: (number, oid) =>
        Effect.map(fails("enqueue"), () => {
          w.calls.push(Call.cases.enqueue.make({ number, oid }));
        }),
      files: (number) => Effect.map(fails("files"), () => w.files.get(number) ?? []),
      patches: (number) => Effect.map(fails("patches"), () => w.patches.get(number) ?? []),
      arm: (number, oid) =>
        Effect.map(fails("arm"), () => {
          w.calls.push(Call.cases.arm.make({ number, oid }));
        }),
      admin: (number, oid) =>
        Effect.map(fails("admin"), () => {
          w.calls.push(Call.cases.admin.make({ number, oid }));
        }),
    }),
  );
};
