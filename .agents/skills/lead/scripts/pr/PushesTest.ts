// PushesTest.layer: the Pushes service in memory, built on the Recorder (0579). A leak grep refuses
// or passes as told, and each push that passes moves the branch on a remote kept in memory, as
// `origin` would. The Recorder keeps every call in order, with all its args, so a test reads that
// the grep ran before the push with `Recorder.calls(Pushes)`, inside the layer it provided.
import { Recorder } from "@kampus/vitest";
import { Effect, type Layer } from "effect";
import { Pushes } from "./Pushes.ts";

export type Remote = {
  /** Each branch on the remote, and the head it points at. */
  readonly branches: Map<string, string>;
};

export const remote = (): Remote => ({ branches: new Map() });

/** The methods that refuse, each with the error it refuses with. A refused push moves no branch. */
export type Failing = Recorder.Fails<Pushes["Service"]>;

export const layer = (r: Remote, fails: Failing = {}): Layer.Layer<Pushes | Recorder.Recorded<Pushes>> =>
  Recorder.layer(
    Pushes,
    {
      leakGrep: () => Effect.void,
      leakChange: () => Effect.void,
      leakText: () => Effect.void,
      push: (_dir, branch, head) =>
        Effect.sync(() => {
          r.branches.set(branch, head);
        }),
    },
    { fails },
  );
