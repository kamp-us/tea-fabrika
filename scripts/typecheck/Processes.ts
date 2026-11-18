// Processes: what the typecheck asks about other processes on the machine. This file is the
// contract only (0095): `ProcessesPs.layer` asks pgrep, ps and kill(pid, 0), and
// `ProcessesTest.layer` answers from a table. Today's tooling (0113), following next/'s rules (0033).
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { Liveness } from "./Look.ts";

/** What pgrep found: the pids it listed, none included, or a refusal to list at all. */
export const Listing = Schema.TaggedUnion({
  listed: { pids: Schema.Array(Schema.Int) },
  refused: {},
});

export type Listing = typeof Listing.Type;

export class Processes extends Context.Service<
  Processes,
  {
    /** This process's pid, the one a lock label names. */
    readonly self: number;
    /** The processes named exactly `name`, as `pgrep -x` lists them. */
    readonly named: (name: string) => Effect.Effect<Listing>;
    /** A process's command line, as `ps -o args=` prints it, or "" where ps cannot read it. */
    readonly args: (pid: number) => Effect.Effect<string>;
    /** Whether a process is gone, or running and since when, where ps can read it. */
    readonly liveness: (pid: number) => Effect.Effect<Liveness>;
  }
>()("scripts/typecheck/Processes") {}
