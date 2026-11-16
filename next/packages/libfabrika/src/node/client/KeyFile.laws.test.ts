// P39 slice 4b, next/: the hands key file's merge-line laws K1 and K2, over the in-memory file system
// (`MemoryFiles.test-support.ts`). K3, on the real file system, runs on the schedule.
//
// What these laws hold `node/client/KeyFile.ts` to, from the approved plan
// (docs/plan/quests/p39-s5-PLAN.md, "The key"):
// - `KeyFile.layer({ file })` supplies `ClientKey` from Effect's `FileSystem` (and `Path`) over one file.
// - `current(null)` on no file makes a pair and answers `created`; on a file with mode 0600 it
//   answers `reused` with that key; on a file with group or other bits it fails `ClientKeyError {
//   op: "read", error: "NotAllowedError" }` and never uses it; on a damaged file it fails `{ op:
//   "read", error: "DataError" }` and leaves the file as it was. `current(fp)`, `fp` the stored key's
//   fingerprint, makes a new pair and answers `replaced`. Any other fingerprint is no reason to
//   replace. A key is made with mode 0600.
// - The identity it answers is the door's: its `raw`, `fingerprint` and `line` agree, and its
//   `sign` makes a hello the door admits.
//
// Each open builds the layer again over the same disk, as a new hands process would. The walk is
// fast-check's `fc.commands`: each step is picked from the steps the state it reached allows (0093),
// and the model is the oracle.
//
// Plants, each run once and undone (recorded in the tests step's field row): K1, make a new key when
// the file does not decode. K2, compute the fingerprint over the key line instead of the raw bytes.
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as fc from "fast-check";
import { property } from "../../Testing.test-support.ts";
import { ClientKey, ClientKeyError, type Identity } from "../../transport/ClientKey.ts";
import { checkHello, helloText } from "../../transport/Hello.ts";
import { writeSshsig } from "../../transport/Sshsig.ts";
import { Admission } from "../../transport/Wire.ts";
import * as KeyFile from "./KeyFile.ts";
import * as MemoryFiles from "./MemoryFiles.test-support.ts";

const FOLDER = "/fabrika-home/hands";

const FILE = `${FOLDER}/key.json`;

const ORIGIN = "http://127.0.0.1:18787";

/** What the model knows of the file: none, or one that is damaged, too open, or both. */
type Model = {
  file: null | { damaged: boolean; wide: boolean };
  fingerprint: string | null;
};

/** The disk, and the step's Effect that `run` hands the walk: fast-check's `run` is synchronous. */
type Real = { readonly disk: MemoryFiles.Disk; next: Effect.Effect<string> | null };

/** One step of the walk: `check` says whether the state allows it, `step` does it and checks the answer. */
interface Step extends fc.Command<Model, Real> {
  readonly step: (m: Model, r: Real) => Effect.Effect<string>;
}

/** fast-check's `run` only hands the walk the step's Effect, which the walk then runs at once. */
function handOff(this: Step, m: Model, r: Real) {
  r.next = this.step(m, r);
}

const open = (r: Real, rejected: string | null) =>
  ClientKey.use((keys) => keys.current(rejected)).pipe(
    Effect.provide(
      KeyFile.layer({ file: FILE }).pipe(Layer.provide(Layer.mergeAll(MemoryFiles.layer(r.disk), Path.layer))),
    ),
    Effect.exit,
  );

/** The key error a failed open must be, from its cause. */
const keyError = (exit: Exit.Exit<Identity, ClientKeyError>): ClientKeyError | null =>
  Exit.isFailure(exit) ? Option.getOrNull(Cause.findErrorOption(exit.cause)) : null;

const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/** A hands start: `current` with no fingerprint, the stored key's, or another key's. */
const openStep = (rejected: "none" | "stored" | "other"): Step => ({
  check: (m) =>
    rejected === "stored" ? m.file !== null && !m.file.damaged && !m.file.wide && m.fingerprint !== null : true,
  run: handOff,
  toString: () => `open(${rejected})`,
  step: (m, r) => {
    const label = `open(${rejected})`;

    return Effect.gen(function* () {
      const before = MemoryFiles.read(r.disk, FILE);
      const fp = rejected === "stored" ? m.fingerprint : rejected === "other" ? "SHA256:not-this-key" : null;
      const exit = yield* open(r, fp);

      if (m.file === null) {
        expect(Exit.isSuccess(exit), `K1: ${label}: no file makes a key, ${String(exit)}`).toBe(true);
        const id = Exit.isSuccess(exit) ? exit.value : null;
        expect(id?.found, "K1: the first open of an empty folder answers created").toBe("created");
        expect((MemoryFiles.read(r.disk, FILE)?.mode ?? 0) & 0o777, "K1: a new key file has mode 0600").toBe(0o600);
        m.file = { damaged: false, wide: false };
        m.fingerprint = id?.fingerprint ?? null;

        return "created";
      }

      if (m.file.damaged || m.file.wide) {
        const error = keyError(exit);
        expect(error, `K1: ${label}: a damaged or too open file is a key error, ${String(exit)}`).toBeInstanceOf(
          ClientKeyError,
        );
        const allowed = [...(m.file.damaged ? ["DataError"] : []), ...(m.file.wide ? ["NotAllowedError"] : [])];
        expect(error?.op, "K1: the failure is reading the key").toBe("read");
        expect(allowed, "K1: a damaged file is DataError, a too open file NotAllowedError").toContain(error?.error);
        const after = MemoryFiles.read(r.disk, FILE);
        expect(
          same(after?.bytes, before?.bytes),
          "K1: a file that fails to read is left as it was, never replaced",
        ).toBe(true);
        expect(after?.mode, "K1: its mode is left as it was").toBe(before?.mode);

        return m.file.damaged ? "damaged" : "wide";
      }

      expect(Exit.isSuccess(exit), `K1: ${label}: a good file opens, ${String(exit)}`).toBe(true);
      const id = Exit.isSuccess(exit) ? exit.value : null;

      if (rejected === "stored") {
        expect(id?.found, "K1: the stored key's own fingerprint, removed by the door, is replaced").toBe("replaced");
        expect(id?.fingerprint, "K1: a replaced key is a new key").not.toBe(m.fingerprint);
        expect((MemoryFiles.read(r.disk, FILE)?.mode ?? 0) & 0o777, "K1: a replacing key file has mode 0600").toBe(
          0o600,
        );
        m.fingerprint = id?.fingerprint ?? null;

        return "replaced";
      }

      expect(id?.found, `K1: ${label}: a good file is reused`).toBe("reused");
      expect(id?.fingerprint, "K1: reused means the same key").toBe(m.fingerprint);
      expect(same(MemoryFiles.read(r.disk, FILE)?.bytes, before?.bytes), "K1: reusing never writes the file").toBe(
        true,
      );

      return `reused:${rejected}`;
    });
  },
});

/** Something else writes over the key file, keeping its mode. */
const damageStep = (form: "bytes" | "truncated" | "empty-object" | "other-key-type", bytes: Uint8Array): Step => ({
  check: (m) => m.file !== null,
  run: handOff,
  toString: () => `damage(${form})`,
  step: (m, r) =>
    Effect.sync(() => {
      const entry = r.disk.entries.get(FILE);

      if (entry?.type !== "File" || m.file === null) {
        return "skip";
      }

      const text = new TextDecoder().decode(entry.bytes);
      entry.bytes =
        form === "truncated"
          ? entry.bytes.slice(0, Math.max(0, Math.min(entry.bytes.length - 2, bytes.length)))
          : form === "empty-object"
            ? new TextEncoder().encode("{}")
            : form === "other-key-type"
              ? new TextEncoder().encode(text.replace('"OKP"', '"RSA"').replace('"Ed25519"', '"P-256"'))
              : // Leading 0xFF: never JSON, whatever follows.
                new Uint8Array([0xff, ...bytes]);
      m.file.damaged = true;

      return "damage";
    }),
});

/** A person or a tool gives the key file group or other bits. */
const widenStep = (extra: number): Step => ({
  check: (m) => m.file !== null,
  run: handOff,
  toString: () => `widen(0o${(0o600 | extra).toString(8)})`,
  step: (m, r) =>
    Effect.sync(() => {
      const entry = r.disk.entries.get(FILE);

      if (entry?.type !== "File" || m.file === null) {
        return "skip";
      }

      entry.mode = 0o600 | extra;
      m.file.wide = true;

      return "widen";
    }),
});

/** A person deletes the key file. */
const removeStep = (): Step => ({
  check: (m) => m.file !== null,
  run: handOff,
  toString: () => "remove",
  step: (m, r) =>
    Effect.sync(() => {
      r.disk.entries.delete(FILE);
      m.file = null;
      m.fingerprint = null;

      return "remove";
    }),
});

const Steps = fc.commands(
  [
    fc.constantFrom("none", "stored", "other").map(openStep),
    fc.constantFrom("none", "none", "stored").map(openStep),
    fc
      .record({
        form: fc.constantFrom("bytes", "truncated", "empty-object", "other-key-type"),
        bytes: fc.uint8Array({ maxLength: 64 }),
      })
      .map(({ form, bytes }) => damageStep(form, bytes)),
    // Any group or other bit, never none.
    fc.integer({ min: 1, max: 0o077 }).map(widenStep),
    fc.constant(null).map(removeStep),
  ],
  { size: "+1" },
);

describe("P39 slice 4b: the hands key file", () => {
  it.live(
    "K1: on an empty folder the first current(null) answers created, every later one reused with the same fingerprint; current(stored) answers replaced with a new one; a damaged file is a read error and is left as it was; a file with group or other bits is a read error and is never used",
    () =>
      Effect.gen(function* () {
        const reached = new Set<string>();
        yield* property(
          Steps,
          (steps) =>
            Effect.gen(function* () {
              const r: Real = { disk: MemoryFiles.disk([FOLDER]), next: null };
              const m: Model = { file: null, fingerprint: null };

              // fast-check's own model walk: a step runs only when the state it reached allows it.
              for (const s of steps) {
                if (s.check(m)) {
                  s.run(m, r);
                  const next = r.next;
                  r.next = null;

                  if (next !== null) {
                    reached.add(yield* next);
                  }
                }
              }
            }),
          { numRuns: 100 },
        );
        // An empty walk cannot pass: each answer the law names was really reached.
        expect([...reached]).toEqual(
          expect.arrayContaining([
            "created",
            "reused:none",
            "reused:other",
            "replaced",
            "damaged",
            "wide",
            "damage",
            "widen",
            "remove",
          ]),
        );
      }),
    300_000,
  );

  it.live(
    "K2: the key file's identity passes the door's own hello check: its raw, fingerprint and line agree, and a hello signed with its sign is admitted",
    () =>
      property(
        fc.record({
          nonce: fc.string({ minLength: 1, maxLength: 40 }),
          tab: fc.string({ minLength: 1, maxLength: 40 }),
        }),
        ({ nonce, tab }) =>
          Effect.gen(function* () {
            const r: Real = { disk: MemoryFiles.disk([FOLDER]), next: null };
            const exit = yield* open(r, null);
            expect(Exit.isSuccess(exit), `K2: a new key opens, ${String(exit)}`).toBe(true);

            if (!Exit.isSuccess(exit)) {
              return;
            }

            const key = exit.value;

            const signed = yield* writeSshsig({
              text: helloText({ url: ORIGIN, tab, nonce }),
              space: "fabrika-client",
              line: key.line,
              sign: key.sign,
            });

            const hello = {
              versions: [1],
              has: ["git"],
              ping: "5s",
              key: key.raw,
              tab,
              nonce,
              platform: "headless",
              os: "macos",
              build: "k2-build",
              sentAt: "2026-11-15T10:00:00.000Z",
              signed,
            };

            const checked = yield* checkHello({
              hello,
              url: ORIGIN,
              tab,
              nonce,
              name: key.fingerprint,
              versions: [1],
              ping: { min: 1000, max: 60_000 },
              consume: () => true,
              admit: (fingerprint) =>
                Effect.succeed(
                  Admission.cases.admitted.make({ identity: { key: fingerprint, person: "person_k2", as: "hands" } }),
                ),
            });

            expect(checked._tag, `K2: the door admits the key file's hello: ${JSON.stringify(checked)}`).toBe("online");
          }),
        { numRuns: 60 },
      ),
    120_000,
  );
});
