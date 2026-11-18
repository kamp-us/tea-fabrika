// Stack: how the lead lands a native stack of pull requests (`land.ts stack <top-pr>`), the one way
// it is landed; never a bare `gh stack merge`. Today's lead tooling, run on our own laptop; it is not
// product (ticket 1115).
//
//   land   the top pull request is in an open stack -> every layer is open and ready or already
//          merged -> the leak gate (./Leaks.ts) passes on each open layer's change, its commits and
//          its words -> each layer's new exported names are named under `## New names`
//          (Names.ts, 0587) -> `ci-required` is a success at each open layer's head, read once as
//          `land.ts queue` reads it (ticket 1119) -> reread the selected stack prefix and ask GitHub
//          to merge it, pinned to the selected top head
//
// Merge when ready is not offered for a stacked pull request (github/gh-stack#591), so `land.ts arm`
// cannot land one, and the stack merge runs past `arm`'s gates unless this module runs them first.
//
// Read through its module: `Stack.land(...)`.
import { Effect, Option, Schema } from "effect";
import { Checks, type Job } from "../ci/Checks.ts";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { type Detail, PullRequests } from "./PullRequests.ts";
import { REQUIRED } from "./Queue.ts";

/** The stack was not landed, and nothing was asked of GitHub's merge. */
export class NotLanded extends Schema.TaggedError<NotLanded>()("NotLanded", { reason: Schema.String }) {}

/** How a layer's required check stands when it is not a success: not made yet, not ended, or ended another way. */
const Standing = Schema.Literals(["missing", "pending", "failed"]);

/**
 * A layer's `ci-required` is not a success at the head its gates read, so the stack was not landed
 * and nothing was asked of GitHub's merge. The merge queue would test the stack anyway, but a red
 * layer there throws the whole merge group out of the queue.
 */
export class RequiredNotGreen extends Schema.TaggedError<RequiredNotGreen>()("RequiredNotGreen", {
  top: Schema.Finite,
  pr: Schema.Finite,
  oid: Schema.String,
  state: Standing,
}) {
  get reason(): string {
    return `stack of pr ${this.top}: pr ${this.pr}: ${REQUIRED} is ${this.state} at ${this.oid}, not a success; nothing was merged`;
  }
}

/** How the required check stands, or `null` when it ended a success: read as `Queue.add` reads it. */
const standing = (job: Option.Option<Job>): typeof Standing.Type | null =>
  Option.isNone(job)
    ? "missing"
    : job.value.status !== "completed"
      ? "pending"
      : job.value.conclusion === "success"
        ? null
        : "failed";

export type Ask = {
  /** A checkout of the repo, to fetch each head into for the leak gate. */
  readonly dir: string;
  /** The top pull request to land: its stack lands from the bottom up to it. */
  readonly top: number;
};

/** What GitHub says happened to the stack merge request, or that the top was merged already. */
export const Landed = Schema.TaggedUnion({
  enqueued: { top: Schema.Finite, base: Schema.String, prs: Schema.Array(Schema.Finite) },
  pending: { top: Schema.Finite, base: Schema.String, prs: Schema.Array(Schema.Finite), uuid: Schema.String },
  already: { top: Schema.Finite, commit: Schema.String },
  merged: { top: Schema.Finite, commit: Schema.String },
});

export type Landed = typeof Landed.Type;

/** Why one layer below the top may not land as it stands, or `null` when it may. A merged one is done. */
const layerRefusal = (found: Detail): string | null =>
  found.state === "CLOSED"
    ? `pr ${found.number} is closed, not merged, so the layers above it cannot land`
    : found.state === "OPEN" && found.draft
      ? `pr ${found.number} is a draft; mark it ready first`
      : null;

export const land = Effect.fn("Stack.land")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const refuse = (reason: string) => new NotLanded({ reason: `stack of pr ${a.top}: ${reason}` });
  const stack = yield* prs.stack(a.top);

  if (Option.isNone(stack)) {
    return yield* refuse("it is in no open stack on GitHub; land it with land.ts arm");
  }

  const at = stack.value.prs.findIndex((layer) => layer.number === a.top);

  if (at === -1) {
    return yield* refuse(`pr ${a.top} is not in the stack GitHub returned`);
  }

  const prefix = stack.value.prs.slice(0, at + 1);
  const layers = yield* Effect.forEach(prefix, ({ number }) => prs.view(number), { concurrency: "unbounded" });

  const off = prefix.filter((pin, index) => layers[index]?.oid !== pin.oid);

  if (off.length > 0) {
    return yield* refuse(
      `pr heads changed while the stack was read (${off.map((pin) => pin.number).join(", ")}); nothing was asked of GitHub`,
    );
  }

  const top = layers.at(-1);

  if (top?.state === "MERGED") {
    const remaining = layers.filter((layer) => layer.state !== "MERGED");

    if (remaining.length > 0) {
      return yield* refuse(
        `pr ${top.number} is merged but selected lower layers ${remaining.map((layer) => layer.number).join(", ")} are not; no complete stack result was reported`,
      );
    }

    if (top.mergeCommit === null) {
      return yield* refuse(`GitHub says pr ${top.number} is merged but returned no merge commit`);
    }

    return Landed.cases.already.make({ top: top.number, commit: top.mergeCommit });
  }

  const open = layers.filter((layer) => layer.state === "OPEN");

  for (const layer of layers) {
    const refused = layerRefusal(layer);

    if (refused !== null) {
      return yield* refuse(refused);
    }
  }

  // The stack merge merges later with no one watching, so every layer's gates run before it is asked.
  for (const layer of open) {
    yield* Leaks.gate(a.dir, layer);
    const unnamed = Names.refusal(layer.body, yield* prs.patches(layer.number));

    if (unnamed !== null) {
      return yield* refuse(`pr ${layer.number}: ${unnamed}`);
    }
  }

  const checks = yield* Checks;

  for (const layer of open) {
    const state = standing(yield* checks.job(layer.oid, REQUIRED));

    if (state !== null) {
      return yield* new RequiredNotGreen({ top: a.top, pr: layer.number, oid: layer.oid, state });
    }
  }

  const result = yield* prs.mergeStack({ number: stack.value.number, base: stack.value.base, layers });
  const numbers = open.map((layer) => layer.number);

  return result._tag === "merged"
    ? Landed.cases.merged.make({ top: a.top, commit: result.commit })
    : result._tag === "enqueued"
      ? Landed.cases.enqueued.make({ top: a.top, base: stack.value.base, prs: numbers })
      : Landed.cases.pending.make({ top: a.top, base: stack.value.base, prs: numbers, uuid: result.uuid });
});

/** One line for a log: what `land` did. */
export const line = (landed: Landed): string =>
  Landed.match(landed, {
    enqueued: ({ top, base, prs }) =>
      `stack of pr ${top}: GitHub added ${prs.join(", ")} to the ${base} merge queue; they are not merged yet`,
    pending: ({ top, base, prs, uuid }) =>
      `stack of pr ${top}: GitHub merge request ${uuid} for ${prs.join(", ")} into ${base} is pending; they are not merged yet`,
    already: ({ top, commit }) => `stack of pr ${top}: already merged at ${commit}`,
    merged: ({ top, commit }) => `stack of pr ${top}: GitHub merged the selected prefix at ${commit}`,
  });
