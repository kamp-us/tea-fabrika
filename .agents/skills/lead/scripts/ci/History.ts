// History and Issues: what ci-speed.ts asks GitHub. This file is the contract only (0095):
// `HistoryGh.layer` asks GitHub through `gh api`, `HistoryTest.layer` answers from lists in memory.
// History only reads. Issues writes the one `ci-scheduled` issue this measure keeps (0541).
// Today's lead tooling; it is not product.
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { Issue, Job, Pull, Run } from "./Speed.ts";

/** GitHub could not be asked, refused, or answered in a shape we do not read. */
export class HistoryError extends Schema.TaggedError<HistoryError>()("HistoryError", { reason: Schema.String }) {}

export class History extends Context.Service<
  History,
  {
    /** Every workflow run created in [from, to), as ISO times, of every workflow. */
    readonly runs: (from: string, to: string) => Effect.Effect<ReadonlyArray<Run>, HistoryError>;
    /** Every job of run `id`, of every attempt. */
    readonly jobs: (id: number) => Effect.Effect<ReadonlyArray<Job>, HistoryError>;
    /** The pull requests merged at or after `since`, an ISO time. */
    readonly merged: (since: string) => Effect.Effect<ReadonlyArray<Pull>, HistoryError>;
  }
>()("@tea-fabrika/agents/skills/lead/scripts/ci/History") {}

export class Issues extends Context.Service<
  Issues,
  {
    /** The open issues that carry `label`. */
    readonly open: (label: string) => Effect.Effect<ReadonlyArray<Issue>, HistoryError>;
    /** Opens an issue with `label`, and answers its number. */
    readonly create: (title: string, body: string, label: string) => Effect.Effect<number, HistoryError>;
    readonly comment: (number: number, body: string) => Effect.Effect<void, HistoryError>;
    readonly close: (number: number) => Effect.Effect<void, HistoryError>;
  }
>()("@tea-fabrika/agents/skills/lead/scripts/ci/History/Issues") {}
