// The laws of the in-memory adapter: its ids are git's (M1), its store refuses what git refuses (M2), and it
// passes the shared laws of Repository (S1 to S10), at 100 runs.
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Result, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Commit from "./Commit.ts";
import * as CommitId from "./CommitId.ts";
import fastImport from "./fixtures/fast-import-2.40.1.json" with { type: "json" };
import { missingId, shapes, textureArb, type History, type Person } from "./HistoryTest.ts";
import * as MemoryRepository from "./MemoryRepository.ts";
import * as Ref from "./Ref.ts";
import * as Repository from "./Repository.ts";
import * as RepositoryTest from "./RepositoryTest.ts";

const signature = (person: Person): Commit.Signature =>
  new Commit.Signature({
    name: person.name,
    email: person.email,
    at: { seconds: person.seconds, offset: person.offset },
  });

const commitIdFrom = (text: string): CommitId.CommitId => Schema.decodeUnknownSync(CommitId.CommitId)(text);

const refNameFrom = (text: string): Ref.RefName => Schema.decodeUnknownSync(Ref.RefName)(text);

const idAt = (ids: ReadonlyArray<CommitId.CommitId>, index: number): CommitId.CommitId => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error(`no id for commit ${index}`);
  }

  return id;
};

/** A store holding the history: ids computed as git computes them, refs pointed, shallow commits marked. */
const build = (
  history: History,
): Effect.Effect<
  { readonly store: MemoryRepository.Store; readonly ids: ReadonlyArray<CommitId.CommitId> },
  never,
  Digest.Digest
> =>
  Effect.gen(function* () {
    let store = MemoryRepository.empty;
    const ids: Array<CommitId.CommitId> = [];

    for (const node of history.nodes) {
      const commit = yield* MemoryRepository.commit({
        parents: node.parents.map((parent) => idAt(ids, parent)),
        author: signature(node.author),
        committer: signature(node.committer),
        message: node.message,
      });

      store = yield* Effect.orDie(Effect.fromResult(MemoryRepository.add(store, commit)));
      ids.push(commit.id);
    }

    for (const ref of history.refs) {
      store = yield* Effect.orDie(
        Effect.fromResult(MemoryRepository.point(store, refNameFrom(ref.name), idAt(ids, ref.commit))),
      );
    }

    return { store: { ...store, shallow: new Set(history.shallow.map((i) => idAt(ids, i))) }, ids };
  });

const Recorded = Schema.Struct({
  git: Schema.String,
  command: Schema.String,
  rows: Schema.Array(
    Schema.Struct({
      note: Schema.String,
      parents: Schema.Array(Schema.String),
      author: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
        at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
      }),
      committer: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
        at: Schema.Struct({ seconds: Schema.Finite, offset: Schema.String }),
      }),
      message: Schema.String,
      id: Schema.String,
    }),
  ),
});

// vector: git 2.40.1's fast-import gave each commit below its id, and memory computes the same one.
// Plant: drop the blank line before the message; write the offset as `+0000` for `-0000`; put the
// parents in sorted order.
it.effect("M1 vector: MemoryRepository.commit computes the id git gave each recorded commit", () =>
  Effect.gen(function* () {
    const recorded = Schema.decodeUnknownSync(Recorded)(fastImport);
    expect(recorded.git).toContain("git version");
    expect(recorded.rows.length, "the list is not empty").toBeGreaterThan(20);

    for (const row of recorded.rows) {
      const commit = yield* MemoryRepository.commit({
        parents: row.parents.map(commitIdFrom),
        author: new Commit.Signature(row.author),
        committer: new Commit.Signature(row.committer),
        message: row.message,
      });

      expect(commit.id, row.note).toBe(row.id);
    }
  }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

const refusal = (result: Result.Result<unknown, unknown>, reason: string, place: string): void => {
  expect(Result.isFailure(result), `${place} is refused`).toBe(true);

  if (Result.isFailure(result)) {
    RepositoryTest.expectFailure(result.failure, MemoryRepository.BadStore, { reason }, `${place} says why`);
  }
};

// Plant: let a ref and a ref below it both in.
it.effect.prop(
  "M2 the store refuses what git refuses: a missing parent, a ref at a missing commit, a ref beside a ref below it",
  { texture: textureArb },
  ({ texture }) =>
    Effect.gen(function* () {
      const all = shapes(texture);

      for (const shape of all) {
        yield* build(shape.history);
      }

      const root = all.find((shape) => shape.label === "one root");
      const person = texture.people[0];

      if (root === undefined || person === undefined) {
        return yield* Effect.die("the generator made no root or person");
      }

      const { store, ids } = yield* build(root.history);
      const first = idAt(ids, 0);
      const gone = commitIdFrom(missingId(texture, 0, ids));

      const orphan = yield* MemoryRepository.commit({
        parents: [gone],
        author: signature(person),
        committer: signature(person),
        message: "orphan",
      });

      refusal(MemoryRepository.add(store, orphan), "missing-parent", "a commit whose parent is missing");
      refusal(
        MemoryRepository.point(store, refNameFrom("refs/conflict/other"), gone),
        "missing-commit",
        "a ref at a missing commit",
      );
      const part = texture.parts[0] ?? "p";
      const above = refNameFrom(`refs/conflict/${part}`);
      const below = refNameFrom(`refs/conflict/${part}/b`);

      for (const [one, two] of [
        [above, below],
        [below, above],
      ] as const) {
        const held = yield* Effect.orDie(Effect.fromResult(MemoryRepository.point(store, one, first)));
        refusal(MemoryRepository.point(held, two, first), "ref-conflict", `${one} beside ${two}`);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { runs: 100, seed: 119120 } },
);

const subject: RepositoryTest.Subject = {
  seed: (history, config) =>
    Effect.gen(function* () {
      const { store, ids } = yield* build(history);
      const context = yield* Layer.build(MemoryRepository.layer(store, config));

      return {
        repository: Context.get(context, Repository.Repository),
        ids,
        fingerprint: Context.get(context, MemoryRepository.MemoryStore).get,
        hidden: [],
      };
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
};

RepositoryTest.suite("memory", subject, { runs: 100, timeout: 300_000 });
