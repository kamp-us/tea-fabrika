// Stack: how the lead lands a native stack of pull requests (`land.ts stack <top-pr>`), the one way
// it is landed; never a bare `gh stack merge`. Today's lead tooling, run on our own laptop; it is not
// product (ticket 1115).
//
//   land   the top pull request is in an open stack -> each layer from the bottom up to it is open
//          and not a draft -> the leak gate (./Leaks.ts) passes on each layer's change, its commits
//          and its words -> each layer's new exported names are named under `## New names`
//          (Names.ts, 0587) -> the open layers fit one merge group of the base branch's merge
//          queue -> one stack merge, squashes, pinned to the heads the gates read
//
// Merge when ready is not offered for a stacked pull request (github/gh-stack#591), so `land.ts arm`
// cannot land one, and the stack merge runs past `arm`'s gates unless this module runs them first.
//
// The size check: a stack enters the queue as one entry per layer, and the queue builds at most
// `max_entries_to_build` at once. A larger stack is split: on 2026-11-16 a 4-layer stack entered a
// queue that builds 2, the queue squashed the bottom layer alone, turned the next layer onto main,
// and dropped it as conflicting, with every layer above it (stack 1522; github/gh-stack#444, #601,
// #616). The size is read from the base branch's rules each time, since it is the owner's setting.
// Read through its module: `Stack.land(...)`.
import { Effect, Option, Schema } from "effect";
import * as Leaks from "./Leaks.ts";
import * as Names from "./Names.ts";
import { type Detail, type MergeQueue, PullRequests } from "./PullRequests.ts";

/** The stack was not landed, and nothing was asked of GitHub's merge. */
export class NotLanded extends Schema.TaggedError<NotLanded>()("NotLanded", { reason: Schema.String }) {}

export type Ask = {
  /** A checkout of the repo, to fetch each head into for the leak gate. */
  readonly dir: string;
  /** The top pull request to land: its stack lands from the bottom up to it. */
  readonly top: number;
};

/** What `land` did: asked for the stack merge of these layers, or found the top merged already. */
export const Landed = Schema.TaggedUnion({
  asked: { top: Schema.Finite, base: Schema.String, prs: Schema.Array(Schema.Finite) },
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

/**
 * Why `open` layers do not fit one merge group of the queue, or `null` when they do: more open
 * layers than the queue builds at once. No queue on the base merges the stack directly, in one go.
 */
const sizeRefusal = (open: ReadonlyArray<number>, base: string, queue: Option.Option<MergeQueue>) =>
  Option.isSome(queue) && open.length > queue.value.build
    ? `the stack lands ${open.length} open pull requests (${open.join(", ")}), more than the ${queue.value.build} the ${base} merge queue builds at once (max_entries_to_build); the queue would split it and drop the layers above the first. Split the stack, or land it layer by layer`
    : null;

export const land = Effect.fn("Stack.land")(function* (a: Ask) {
  const prs = yield* PullRequests;
  const refuse = (reason: string) => new NotLanded({ reason: `stack of pr ${a.top}: ${reason}` });
  const stack = yield* prs.stack(a.top);

  if (Option.isNone(stack)) {
    return yield* refuse("it is in no open stack on GitHub; land it with land.ts arm");
  }

  const below = stack.value.prs.slice(0, stack.value.prs.indexOf(a.top) + 1);
  const layers = yield* Effect.forEach(below, (number) => prs.view(number), { concurrency: "unbounded" });
  const top = layers.at(-1);

  if (top?.state === "MERGED") {
    return Landed.cases.merged.make({ top: top.number, commit: top.mergeCommit ?? top.oid });
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

  const numbers = open.map((layer) => layer.number);
  const tooBig = sizeRefusal(numbers, stack.value.base, yield* prs.mergeQueue(stack.value.base));

  if (tooBig !== null) {
    return yield* refuse(tooBig);
  }

  yield* prs.mergeStack(
    a.top,
    open.map((layer) => ({ number: layer.number, oid: layer.oid })),
  );
  return Landed.cases.asked.make({ top: a.top, base: stack.value.base, prs: numbers });
});

/** One line for a log: what `land` did. */
export const line = (landed: Landed): string =>
  Landed.match(landed, {
    asked: ({ top, base, prs }) =>
      `stack of pr ${top}: asked GitHub to squash-merge ${prs.join(", ")} into ${base} in one merge, pinned to the heads read; land.ts merged ${prs.join(" ")} once it lands`,
    merged: ({ top, commit }) => `stack of pr ${top}: already merged at ${commit}`,
  });
