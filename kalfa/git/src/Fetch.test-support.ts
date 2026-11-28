// The laws of `fetch` (F1 to F8), run on each adapter's store. A runner gives a `FetchSubject`: how to seed a remote and a local
// repository that fetches from it. Each law draws one texture, makes the remote's history, the local one and every case from it, and
// compares each answer with the model of the remote's refs. They sit beside RepositoryTest.ts, which is `/test`, as the commit edit laws
// do: a law of `fetch` needs the slot's module, and a runner that did not run them would never load it.
//
// The cases: (a) `under` names one ref exactly, a branch or a ref outside the branches; (b) a folder with two refs or more; (c) a remote ref
// that shares the text of `under`; (d) nothing; (f) the local repository holds part of the remote's history, and a branch of the same name
// at another commit; (h) the remote by name; (i) a name with no remote; (j) by each URL; (k) a URL that reaches nothing; (l) a remote whose
// history is cut; (m) a remote ref that moves; (n) one more ref than `limits.refs` and exactly that many; (o) a credential with
// awkward text; (p) the slot fails; (q) the local repository is shallow. F21 holds a fetch where the time limit can fire: (a) before the read answers, (b) after the
// adopt's listing, (c) after the `.pack` rename, (d) after the `.rev` rename, (e) after the `.idx` rename.
import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Cause,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Predicate,
  Redacted,
  References,
  Ref as Cell,
  Result,
  Schema,
  type Scope,
} from "effect";
import { TestClock } from "effect/testing";
import type * as CommitId from "./CommitId.ts";
import * as Credentials from "./Credentials.ts";
import {
  cutShallow,
  refsModel,
  shapes,
  textureArb,
  walkModel,
  partArb,
  type History,
  type Texture,
} from "./History.test-support.ts";
import {
  encodeCommit,
  expectNamedSpan,
  failed,
  idAt,
  numAt,
  plainRefs,
  refNameFrom,
  traced,
} from "./Laws.test-support.ts";
import * as Remote from "./Remote.ts";
import { expectFailure } from "./Repository.test-support.ts";
import * as Repository from "./Repository.ts";
import { settings, type SuiteOptions } from "./RepositoryTest.ts";
import type * as Settings from "./Settings.ts";
import * as Tree from "./Tree.ts";

// ---------------------------------------------------------------------------------------------------------
// What a runner gives
// ---------------------------------------------------------------------------------------------------------

/** Where a subject can hold a fetch, each after the step it names has run: the remote's read, the alternates file, the adopt's listing, and each rename of a pack's file. */
export type Hold = "read" | "alternates" | "listing" | "pack" | "rev" | "idx";

/** A hold the law waits at: `reached` ends when the fetch is there, and the fetch goes on after `open`. */
export interface Gate {
  readonly reached: Effect.Effect<void>;
  readonly open: Effect.Effect<void>;
}

/** A drawn time limit in whole seconds, as F18 and F14 draw theirs. */
const timeArb = Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 3600 })));

// Lets every fiber that can run, run, before the clock moves.
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { concurrency: 1, discard: true });

/** A gate, and the step the held fetch runs: it says it is there, and waits to be opened. */
export const holdGate: Effect.Effect<{ readonly gate: Gate; readonly hold: Effect.Effect<void> }> = Effect.gen(
  function* () {
    const reached = yield* Deferred.make<void>();
    const opened = yield* Deferred.make<void>();

    return {
      gate: { reached: Deferred.await(reached), open: Effect.asVoid(Deferred.succeed(opened, undefined)) },
      hold: Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(opened)),
    };
  },
);

/** A local repository that fetches from a remote, and what the laws may look at. */
export interface FetchSeeded {
  /** The local repository: the service the laws call `fetch` on. */
  readonly repository: Repository.Repository["Service"];
  /** The remote, opened as a repository of its own, so a law reads what the remote holds. */
  readonly remote: Repository.Repository["Service"];
  /** The id of each commit of the local history, by index. A commit the remote and the local share has one id in both. */
  readonly ids: ReadonlyArray<CommitId.CommitId>;
  /** The id of each commit of the remote's history, by index. */
  readonly remoteIds: ReadonlyArray<CommitId.CommitId>;
  /** The remote by the name this repository holds for it, `origin`. */
  readonly named: Remote.Remote;
  /** The URL that name stands for, as this repository holds it. */
  readonly configured: Remote.Url;
  /** The remote by each URL the subject gives, with no name added. */
  readonly urls: ReadonlyArray<Remote.Remote>;
  /** A URL that reaches no repository. */
  readonly nowhere: Remote.Url;
  /** Whether the local repository is shallow now. */
  readonly shallow: Effect.Effect<boolean>;
  /** Anything that changes when the local repository changes. */
  readonly fingerprint: Effect.Effect<unknown>;
  /** Text that must never appear in a span, such as the repositories' paths. */
  readonly hidden: ReadonlyArray<string>;
  /** Points a ref of the remote at its commit `commit`, by index. */
  readonly moveRemoteRef: (ref: string, commit: number) => Effect.Effect<void>;
  /** Every place this subject can hold a fetch of the local repository, in the order a fetch passes them. */
  readonly holds: ReadonlyArray<Hold>;
  /** Arms the next fetch of the local repository to wait at `at`, once, after the step it names has run. */
  readonly hold: (at: Hold) => Effect.Effect<Gate>;
  /** The names in the local repository's pack folder: none where there is no folder. */
  readonly packs: Effect.Effect<ReadonlyArray<string>>;
  /** How many files `git count-objects -v` calls garbage in the local repository: a pack with no index is one. None where there are no files. */
  readonly garbage: Effect.Effect<number>;
}

export interface FetchSubject {
  /** Seeds the remote's history, and a local repository holding `local`, whose remote `origin` is the remote. */
  readonly seed: (
    remote: History,
    local: History,
    settings: Settings.Settings,
  ) => Effect.Effect<FetchSeeded, never, Scope.Scope>;
}

// ---------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------

const nameFrom = (text: string): Remote.Name => Schema.decodeUnknownSync(Remote.Name)(text);

/** The name every subject gives its local repository's one remote, and a name it has none for. */
export const ORIGIN = nameFrom("origin");

export const NOWHERE = nameFrom("nowhere");

/** The text of a `Url` remote's URL. */
const remoteText = (remote: Remote.Remote): string => (Predicate.isTagged(remote, "Url") ? remote.url : "");

// ---------------------------------------------------------------------------------------------------------
// The credential
// ---------------------------------------------------------------------------------------------------------

/** What the user name and the password of a drawn credential each hold, so a leak of either is seen whole. */
export const CREDENTIAL_CLASSES = [
  "twelve characters or more",
  "a space",
  "a quote",
  "$()",
  "a backtick",
  "%s",
  "*",
  "a backslash",
  "a dash",
  "an equals sign",
  "non-ASCII text",
];

const credentialTraits = (text: string): ReadonlyArray<string> =>
  [
    text.length >= 12 ? "twelve characters or more" : "",
    text.includes(" ") ? "a space" : "",
    text.includes('"') && text.includes("'") ? "a quote" : "",
    text.includes("$(") && text.includes(")") ? "$()" : "",
    text.includes("`") ? "a backtick" : "",
    text.includes("%s") ? "%s" : "",
    text.includes("*") ? "*" : "",
    text.includes("\\") ? "a backslash" : "",
    text.includes("-") ? "a dash" : "",
    text.includes("=") ? "an equals sign" : "",
    /[^\p{ASCII}]/u.test(text) ? "non-ASCII text" : "",
  ].filter((trait) => trait !== "");

/** `text` with the character `bad` put into its middle. */
export const credentialText = (text: string, bad: string): string => `${text.slice(0, 3)}${bad}${text.slice(3)}`;

/** A drawn credential as plain text, and the classes both of its fields hold. */
export const credentialArb = Arbitrary.all({ one: partArb, two: partArb, three: partArb }).pipe(
  Arbitrary.map(({ one, two, three }) => {
    const username = `u-${one} "x" 'y' $(z) \`k\` %s * \\ = é設-${two}`;
    const password = `p-${three} "x" 'y' $(z) \`k\` %s * \\ = é設-${one}${two}`;

    const classes = CREDENTIAL_CLASSES.filter(
      (trait) => credentialTraits(username).includes(trait) && credentialTraits(password).includes(trait),
    );

    return { username, password, classes };
  }),
);

/** The credential a drawn text makes. */
const credentialFrom = (drawn: { readonly username: string; readonly password: string }): Credentials.Credential =>
  new Credentials.Credential({ username: drawn.username, password: Redacted.make(drawn.password) });

/** A slot that records each URL it is asked about, and then answers with `answer`, or fails. */
export interface Recorder {
  readonly layer: Layer.Layer<Credentials.Credentials>;
  readonly asked: Effect.Effect<ReadonlyArray<string>>;
}

export const recorder = (answer: Option.Option<Credentials.Credential> | "fails"): Effect.Effect<Recorder> =>
  Effect.gen(function* () {
    const seen = yield* Cell.make<ReadonlyArray<string>>([]);

    return {
      layer: Layer.succeed(Credentials.Credentials)({
        ask: (url) =>
          Effect.andThen(
            Cell.update(seen, (all) => [...all, url]),
            answer === "fails" ? Effect.fail(new Credentials.NoCredential({ url })) : Effect.succeed(answer),
          ),
      }),
      asked: Cell.get(seen),
    };
  });

// ---------------------------------------------------------------------------------------------------------
// The carrier: one remote history, the local one, and every case
// ---------------------------------------------------------------------------------------------------------

const SCENARIO_KEYS = ["plain", "cut", "shallow", "exact", "past"] as const;

type ScenarioKey = (typeof SCENARIO_KEYS)[number];

interface Scenario {
  readonly remote: History;
  readonly local: History;
  readonly settings: Settings.Settings;
}

type Outcome =
  | { readonly kind: "refs"; readonly refs: ReadonlyArray<{ readonly name: string; readonly commit: number }> }
  | { readonly kind: "no-such-remote" }
  | { readonly kind: "fetch-failed" }
  | { readonly kind: "too-short" }
  | { readonly kind: "too-many"; readonly most: number };

interface Attempt {
  readonly label: string;
  readonly scenario: ScenarioKey;
  readonly via: "name" | "url" | "unnamed" | "nowhere";
  readonly under: string;
  readonly outcome: Outcome;
}

interface Carrier {
  readonly scenarios: Readonly<Record<ScenarioKey, Scenario>>;
  readonly attempts: ReadonlyArray<Attempt>;
  /** The ref of the plain scenario that moves between two fetches, and the commit it moves to. */
  readonly move: { readonly ref: string; readonly to: number };
  /** What the slot does in a law: it gives a login, gives none, or fails. */
  readonly slots: ReadonlyArray<"gives none" | "fails">;
}

const found = <A>(item: A | undefined, place: string): A => {
  if (item === undefined) {
    throw new Error(`the carrier found no ${place}`);
  }

  return item;
};

const historyLabeled = (texture: Texture, label: string): History =>
  found(
    shapes(texture).find((shape) => shape.label === label),
    label,
  ).history;

/** The first `k` commits of the remote, and refs of their own: a branch of the same name at another commit, and some a fetch must leave alone. */
const prefix = (remote: History, texture: Texture): History => {
  const count = remote.nodes.length;

  const main = found(
    remote.refs.find((ref) => ref.name === "refs/heads/main"),
    "main",
  ).commit;

  // At least two commits, so the branch of the same name has another commit to sit at, and the remote's `main` is held, so an answered tip is.
  const size = Math.min(count, Math.max(2, 1 + (numAt(texture, 5) % count), main + 1));

  return {
    nodes: remote.nodes.slice(0, size),
    refs: [
      { name: "refs/heads/main", commit: main === 0 ? 1 : 0 },
      { name: "refs/heads/local-only", commit: size - 1 },
      { name: "refs/remotes/origin/main", commit: 0 },
      { name: "refs/tags/local-tag", commit: 1 },
    ],
    shallow: [],
  };
};

const EMPTY: History = { nodes: [], refs: [], shallow: [] };

/** Whether any remote ref the model answers reaches a commit the remote cut. */
const reachesCut = (remote: History, refs: ReadonlyArray<{ readonly commit: number }>): boolean =>
  remote.shallow.some((cut) =>
    walkModel(
      remote,
      refs.map((ref) => ref.commit),
      [],
    ).includes(cut),
  );

const UNDERS = (remote: History): ReadonlyArray<string> => [
  "refs/heads/main",
  found(
    remote.refs.find((ref) => ref.name.startsWith("refs/kalfa/candidates/")),
    "candidate ref",
  ).name,
  "refs/heads",
  "refs/heads/z-",
  "refs/nothing/here",
];

const modelOutcome = (remote: History, under: string): Outcome => {
  const refs = refsModel(remote, under);

  return reachesCut(remote, refs) ? { kind: "too-short" } : { kind: "refs", refs };
};

/** The carrier of one run: the scenarios and every attempt, drawn from one texture. */
export const fetchCarrier = (texture: Texture): Carrier => {
  const random = historyLabeled(texture, "a random graph");
  const line = historyLabeled(texture, "a line");
  const count = random.nodes.length;
  const lineCount = line.nodes.length;
  const base = settings({});
  const heads = refsModel(random, "refs/heads").length;

  // A line with a ref at its tip, which reaches the first commit that has a parent, and a ref at its root, which does not.
  const tipped: History = {
    ...line,
    refs: [
      { name: "refs/heads/main", commit: lineCount - 1 },
      { name: "refs/heads/root", commit: 0 },
    ],
  };

  const scenarios: Carrier["scenarios"] = {
    plain: { remote: random, local: prefix(random, texture), settings: base },
    cut: { remote: { ...tipped, shallow: [1] }, local: EMPTY, settings: base },
    shallow: {
      remote: tipped,
      local: found(cutShallow(prefix(tipped, texture)), "a local history that can be cut"),
      settings: base,
    },
    exact: { remote: random, local: prefix(random, texture), settings: settings({ refs: heads }) },
    past: { remote: random, local: prefix(random, texture), settings: settings({ refs: heads - 1 }) },
  };

  const plain = (under: string, via: Attempt["via"]): Attempt => ({
    label: `plain, ${via}, ${under}`,
    scenario: "plain",
    via,
    under,
    outcome: modelOutcome(random, under),
  });

  const cut = (under: string): Attempt => ({
    label: `cut, name, ${under}`,
    scenario: "cut",
    via: "name",
    under,
    outcome: modelOutcome(scenarios.cut.remote, under),
  });

  const attempts: ReadonlyArray<Attempt> = [
    ...UNDERS(random).flatMap((under) => [plain(under, "name"), plain(under, "url")]),
    { ...plain("refs/heads/main", "unnamed"), outcome: { kind: "no-such-remote" } },
    { ...plain("refs/heads/main", "nowhere"), outcome: { kind: "fetch-failed" } },
    ...["refs/heads/main", "refs/heads/root", "refs/heads", "refs/nothing/here"].map(cut),
    {
      label: "shallow, name, main",
      scenario: "shallow",
      via: "name",
      under: "refs/heads/main",
      outcome: { kind: "too-short" },
    },
    {
      label: "exact, name, heads",
      scenario: "exact",
      via: "name",
      under: "refs/heads",
      outcome: modelOutcome(random, "refs/heads"),
    },
    {
      label: "past, name, heads",
      scenario: "past",
      via: "name",
      under: "refs/heads",
      outcome: { kind: "too-many", most: heads - 1 },
    },
  ];

  const main = found(
    random.refs.find((ref) => ref.name === "refs/heads/main"),
    "main",
  ).commit;

  return {
    scenarios,
    attempts,
    move: { ref: "refs/heads/main", to: (main + 1 + (numAt(texture, 9) % (count - 1))) % count },
    slots: ["gives none", "fails"],
  };
};

const FETCH_CLASSES = [
  "(a) one branch, exactly",
  "(a) one ref outside the branches, exactly",
  "(b) a folder of refs",
  "(c) a remote ref that shares the text",
  "(d) nothing there",
  "(f) the local repository holds an answered tip",
  "(f) a branch of the same name at another commit",
  "(h) the remote by name",
  "(i) a name with no remote",
  "(j) the remote by a URL",
  "(k) a URL that reaches no repository",
  "(l) a remote whose history is cut",
  "(m) a remote ref that moves",
  "(n) one more ref than the limit",
  "(n) exactly the limit",
  "(p) the slot fails",
  "(q) the local repository is shallow",
];

/** The classes a carrier reaches, each decided from the carrier's own data. */
const reachedClasses = (carrier: Carrier): ReadonlyArray<string> => {
  const plainRemote = carrier.scenarios.plain.remote;
  const plainLocal = carrier.scenarios.plain.local;
  const answered = carrier.attempts.flatMap((attempt) => (attempt.outcome.kind === "refs" ? [attempt] : []));
  const only = (attempt: Attempt) => (attempt.outcome.kind === "refs" ? attempt.outcome.refs : []);

  const shares = (under: string): boolean =>
    plainRemote.refs.some(
      (ref) => ref.name.startsWith(under) && ref.name !== under && !ref.name.startsWith(`${under}/`),
    );

  const localMain = plainLocal.refs.find((ref) => ref.name === "refs/heads/main")?.commit;
  const remoteMain = plainRemote.refs.find((ref) => ref.name === "refs/heads/main")?.commit;

  const checks: ReadonlyArray<readonly [string, boolean]> = [
    [
      "(a) one branch, exactly",
      answered.some((a) => only(a).length === 1 && only(a)[0]?.name === a.under && a.under.startsWith("refs/heads/")),
    ],
    [
      "(a) one ref outside the branches, exactly",
      answered.some((a) => only(a).length === 1 && only(a)[0]?.name === a.under && a.under.startsWith("refs/kalfa/")),
    ],
    [
      "(b) a folder of refs",
      answered.some((a) => only(a).length >= 2 && only(a).every((r) => r.name.startsWith(`${a.under}/`))),
    ],
    ["(c) a remote ref that shares the text", answered.some((a) => a.scenario === "plain" && shares(a.under))],
    ["(d) nothing there", answered.some((a) => only(a).length === 0)],
    [
      "(f) the local repository holds an answered tip",
      answered.some((a) => a.scenario === "plain" && only(a).some((r) => r.commit < plainLocal.nodes.length)),
    ],
    [
      "(f) a branch of the same name at another commit",
      localMain !== undefined && remoteMain !== undefined && localMain !== remoteMain,
    ],
    ["(h) the remote by name", carrier.attempts.some((a) => a.via === "name" && a.outcome.kind === "refs")],
    ["(i) a name with no remote", carrier.attempts.some((a) => a.via === "unnamed")],
    ["(j) the remote by a URL", carrier.attempts.some((a) => a.via === "url" && a.outcome.kind === "refs")],
    ["(k) a URL that reaches no repository", carrier.attempts.some((a) => a.via === "nowhere")],
    [
      "(l) a remote whose history is cut",
      carrier.attempts.some((a) => a.scenario === "cut" && a.outcome.kind === "too-short"),
    ],
    ["(m) a remote ref that moves", carrier.move.to !== remoteMain],
    ["(n) one more ref than the limit", carrier.attempts.some((a) => a.outcome.kind === "too-many")],
    ["(n) exactly the limit", carrier.attempts.some((a) => a.scenario === "exact" && a.outcome.kind === "refs")],
    ["(p) the slot fails", carrier.slots.includes("fails")],
    ["(q) the local repository is shallow", carrier.attempts.some((a) => a.scenario === "shallow")],
  ];

  return checks.filter(([, reached]) => reached).map(([name]) => name);
};

// ---------------------------------------------------------------------------------------------------------
// Running an attempt
// ---------------------------------------------------------------------------------------------------------

const remoteFor = (seeded: FetchSeeded, attempt: Attempt, url: Remote.Remote | undefined): Remote.Remote => {
  switch (attempt.via) {
    case "name":
      return seeded.named;
    case "unnamed":
      return Remote.named(NOWHERE);
    case "nowhere":
      return Remote.url(seeded.nowhere);
    case "url":
      return found(url, "URL form");
  }
};

/** The forms an attempt is made in: a URL attempt is made once for each URL the subject gives, the others once. */
const remoteForms = (seeded: FetchSeeded, attempt: Attempt): ReadonlyArray<Remote.Remote> =>
  attempt.via === "url" ? seeded.urls : [remoteFor(seeded, attempt, undefined)];

const call = (seeded: FetchSeeded, remote: Remote.Remote, under: string, slot: Layer.Layer<Credentials.Credentials>) =>
  seeded.repository.fetch({ remote, under: refNameFrom(under) }).pipe(Effect.provide(slot));

/** The remote's refs of a model answer, as the answer holds them: by name and commit id. */
const modelRefs = (
  seeded: FetchSeeded,
  refs: ReadonlyArray<{ readonly name: string; readonly commit: number }>,
): ReadonlyArray<{ readonly name: string; readonly commit: CommitId.CommitId }> =>
  refs.map((ref) => ({ name: ref.name, commit: idAt(seeded.remoteIds, ref.commit) }));

/** Every commit the answered refs reach, read from this repository and equal to the remote's own. */
export const readBack = (
  seeded: FetchSeeded,
  scenario: Scenario,
  refs: ReadonlyArray<{ readonly commit: number }>,
  place: string,
) =>
  Effect.forEach(
    walkModel(
      scenario.remote,
      refs.map((ref) => ref.commit),
      [],
    ),
    (index) =>
      Effect.gen(function* () {
        const id = idAt(seeded.remoteIds, index);
        const here = yield* seeded.repository.readCommit(id);
        const there = yield* seeded.remote.readCommit(id);
        expect(encodeCommit(here), `${place}: commit ${index} reads back as the remote's`).toEqual(encodeCommit(there));

        // The files come with the commit: each path reads the remote's bytes, or fails as the remote's read does.
        for (const file of scenario.remote.nodes[index]?.files ?? []) {
          const path = Schema.decodeUnknownSync(Tree.Path)(file.path);
          const mine = yield* Effect.result(seeded.repository.readFile(id, path));
          const theirs = yield* Effect.result(seeded.remote.readFile(id, path));

          expect(Result.isSuccess(mine), `${place}: commit ${index} reads ${file.path}`).toBe(Result.isSuccess(theirs));

          if (Result.isSuccess(mine) && Result.isSuccess(theirs)) {
            expect(mine.success, `${place}: commit ${index}, the bytes of ${file.path}`).toEqual(theirs.success);
          }
        }
      }),
    { concurrency: 1 },
  );

/** What a failed attempt must have failed with, by the model. */
const expectOutcome = (
  place: string,
  result: Result.Result<ReadonlyArray<{ readonly name: string; readonly commit: string }>, unknown>,
  attempt: Attempt,
  seeded: FetchSeeded,
): void => {
  const { outcome } = attempt;

  if (outcome.kind === "refs") {
    expect(Result.isSuccess(result), `${place}: it answers`).toBe(true);

    if (Result.isSuccess(result)) {
      expect(result.success, `${place}: the answer`).toEqual(modelRefs(seeded, outcome.refs));
    }

    return;
  }

  expect(Result.isFailure(result), `${place}: it fails (${outcome.kind})`).toBe(true);

  if (!Result.isFailure(result)) {
    return;
  }

  switch (outcome.kind) {
    case "no-such-remote":
      return expectFailure(result.failure, Remote.NoSuchRemote, { remote: NOWHERE }, place);
    case "fetch-failed":
      return expectFailure(result.failure, Remote.FetchFailed, { url: seeded.nowhere }, place);
    case "too-short":
      return expectFailure(result.failure, Repository.HistoryTooShort, {}, place);
    case "too-many":
      return expectFailure(result.failure, Repository.TooMany, { limit: "refs", most: outcome.most }, place);
  }
};

/** Seeds each scenario the attempts use, and runs `check` for each attempt with its subject. */
const eachAttempt = <A, E>(
  subject: FetchSubject,
  carrier: Carrier,
  chosen: (attempt: Attempt) => boolean,
  check: (seeded: FetchSeeded, scenario: Scenario, attempt: Attempt) => Effect.Effect<A, E>,
): Effect.Effect<ReadonlyArray<A>, E> =>
  Effect.forEach(
    SCENARIO_KEYS.filter((key) => carrier.attempts.some((attempt) => attempt.scenario === key && chosen(attempt))),
    (key) =>
      Effect.scoped(
        Effect.gen(function* () {
          const scenario = carrier.scenarios[key];
          const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);

          return yield* Effect.forEach(
            carrier.attempts.filter((attempt) => attempt.scenario === key && chosen(attempt)),
            (attempt) => check(seeded, scenario, attempt),
            { concurrency: 1 },
          );
        }),
      ),
    { concurrency: 1 },
  ).pipe(Effect.map((all) => all.flat()));

// ---------------------------------------------------------------------------------------------------------
// What the laws read of a repository
// ---------------------------------------------------------------------------------------------------------

const FOLDERS = ["refs/heads", "refs/kalfa", "refs/remotes", "refs/tags", "refs/fetched"];

/** Every ref of each folder a fetch must leave alone. The limit on refs is lifted for the read, so a small limit never hides a ref. */
const refsOfFolders = (seeded: FetchSeeded) =>
  Effect.forEach(FOLDERS, (folder) => seeded.repository.readRefs(refNameFrom(folder)).pipe(Effect.result), {
    concurrency: 1,
  }).pipe(Effect.map((all) => all.map((one) => (Result.isSuccess(one) ? plainRefs(one.success) : "too many"))));

/** A value as text a leak can be found in: a Map and a Set show what they hold, and bytes show as the text they encode. */
const shown = <A>(value: A): string =>
  JSON.stringify(value, (_key, item) => {
    if (item instanceof Map || item instanceof Set) {
      return [...item];
    }

    if (item instanceof Uint8Array) {
      return new TextDecoder().decode(item);
    }

    // A span's clock is a bigint, which JSON has no form for.
    return Predicate.isBigInt(item) ? String(item) : item;
  });

// ---------------------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------------------

export const suite = (name: string, subject: FetchSubject, options: SuiteOptions): void => {
  const run = { arbitrary: { runs: options.runs, seed: 119120 }, timeout: options.timeout };

  describe(`${name}: the laws of fetch`, () => {
    // Plant: read the answer by text prefix (`startsWith(under)`), so `<under>-2` is answered, F1 red; fetch only `<under>/*`, so the exact ref is
    // missing, red; fetch only under `refs/heads/`, so the candidate ref is missing, red; fetch only the exact ref, so a folder is missing, red;
    // answer only the refs whose commit was new to this repository, red; copy the commits and not their trees or blobs in memory, so a file does not
    // read, red.
    it.effect.prop(
      "F1 the answer: for (a) to (d), (f), (h) and (j), the answer equals the model of the remote's refs at and below under, sorted by UTF-8 bytes, and each answered commit and every commit it reaches reads back equal to the remote's; the carrier reached every class",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          expect(reachedClasses(carrier), "the carrier reaches every class").toEqual(FETCH_CLASSES);
          const slot = yield* recorder(Option.none());
          let answers = 0;

          yield* eachAttempt(
            subject,
            carrier,
            (attempt) => attempt.outcome.kind === "refs",
            (seeded, scenario, attempt) =>
              Effect.forEach(
                remoteForms(seeded, attempt),
                (remote) =>
                  Effect.gen(function* () {
                    const place = `${attempt.label} (${remote._tag})`;
                    const result = yield* Effect.result(call(seeded, remote, attempt.under, slot.layer));
                    expectOutcome(place, result, attempt, seeded);
                    answers += 1;

                    if (attempt.outcome.kind === "refs") {
                      yield* readBack(seeded, scenario, attempt.outcome.refs, place);
                    }
                  }),
                { concurrency: 1 },
              ),
          );

          expect(answers, "the law fetched").toBeGreaterThan(10);
        }),
      run,
    );

    // Plant: fetch with git's default mapping, into `refs/heads/*`, so the local branch moves, F2 red; run the transfer in the repository itself, so
    // the scratch refs land there, red; mark the remote's shallow commits in this store, so the store turns shallow, red.
    it.effect.prop(
      "F2 nothing of this repository changes but its objects: after every answer and every failure, the refs of refs/heads, refs/kalfa, refs/remotes, refs/tags and refs/fetched are as they were, and a repository that was not shallow still is not",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const slot = yield* recorder(Option.none());
          let fetched = 0;

          yield* eachAttempt(
            subject,
            carrier,
            () => true,
            (seeded, _scenario, attempt) =>
              Effect.forEach(
                remoteForms(seeded, attempt),
                (remote) =>
                  Effect.gen(function* () {
                    const place = `${attempt.label} (${remote._tag})`;
                    const wasShallow = yield* seeded.shallow;
                    const before = yield* refsOfFolders(seeded);
                    yield* Effect.result(call(seeded, remote, attempt.under, slot.layer));
                    fetched += 1;

                    expect(yield* refsOfFolders(seeded), `${place}: the refs`).toEqual(before);
                    expect(yield* seeded.shallow, `${place}: shallow`).toBe(wasShallow);
                  }),
                { concurrency: 1 },
              ),
          );

          expect(fetched, "the law fetched").toBeGreaterThan(10);
        }),
      run,
    );

    // Plant: copy the remote's commits into the store before the cut check and the limit check, as the memory adapter once did, so a commit of a
    // fetch that failed `HistoryTooShort` or `TooMany` reads back, F9 red.
    it.effect.prop(
      "F9 a failure adds no commit: after every failure of a fetch, each commit of the remote that this repository did not hold before still reads NoSuchCommit",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const slot = yield* recorder(Option.none());
          let failures = 0;
          let checked = 0;
          const kinds = new Set<string>();

          yield* eachAttempt(
            subject,
            carrier,
            (attempt) => attempt.outcome.kind !== "refs",
            (seeded, _scenario, attempt) =>
              Effect.forEach(
                remoteForms(seeded, attempt),
                (remote) =>
                  Effect.gen(function* () {
                    const place = `${attempt.label} (${remote._tag})`;

                    const missing = yield* Effect.filter(
                      seeded.remoteIds,
                      (id) => Effect.map(Effect.result(seeded.repository.readCommit(id)), Result.isFailure),
                      { concurrency: 1 },
                    );

                    const result = yield* Effect.result(call(seeded, remote, attempt.under, slot.layer));
                    expect(Result.isFailure(result), `${place}: it fails`).toBe(true);
                    failures += 1;
                    kinds.add(attempt.outcome.kind);

                    for (const id of missing) {
                      const read = yield* Effect.result(seeded.repository.readCommit(id));
                      expect(Result.isFailure(read), `${place}: ${id} is still missing`).toBe(true);

                      if (Result.isFailure(read)) {
                        expect(
                          Schema.is(Repository.NoSuchCommit)(read.failure),
                          `${place}: ${id} is NoSuchCommit`,
                        ).toBe(true);
                      }

                      checked += 1;
                    }
                  }),
                { concurrency: 1 },
              ),
          );

          expect(failures, "the law failed some fetches").toBeGreaterThan(5);
          expect(checked, "and looked at some commits").toBeGreaterThan(5);
          expect([...kinds].toSorted(), "the failures it reached").toEqual([
            "fetch-failed",
            "no-such-remote",
            "too-many",
            "too-short",
          ]);
        }),
      run,
    );

    // Plant (F21): copy the commits into the store before the limit ends, as a finalizer, so a fetch that timed out before its read answered adds commits, red at (a);
    // run the adopt inside the time limit (`Effect.timeoutOrElse` around it), so a limit that fires after the listing or a rename answers TimedOut, red at (b) to (e) and
    // at (c) with a `.pack` and no `.idx`, garbage 1; drop the `pack.writeReverseIndex` pin, so no `.rev` is written, red on every git before 2.41 (the hold at (d) is never reached). F19 and F20 hold the rename order, not this law.
    it.effect.prop(
      "F21 cut short at every hold the subject has: before the read answers, the call fails TimedOut, each remote commit this repository lacked still reads NoSuchCommit and no pack file was added; at any hold inside or after the adopt, the call answers the refs, every answered commit reads back, every pack the fetch added has its .pack, .rev and .idx, and git count-objects -v says garbage: 0; the carrier reached every hold its subject names",
      { texture: textureArb, time: timeArb },
      ({ texture, time }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          // The time limit is drawn, so the clock moves by the limit the repository holds and by no number the law knows.
          const scenario: Scenario = {
            ...carrier.scenarios.plain,
            local: EMPTY,
            settings: settings({ time: `${time} seconds` }),
          };
          const under = "refs/heads/main";
          const answered = refsModel(scenario.remote, under);
          const slot = yield* recorder(Option.none());
          const places: Array<Hold> = [];
          let named: ReadonlyArray<Hold> = [];

          // One fresh repository for each hold, since a fetch that answered has added what the next one would have added. The first seed says which holds there are.
          for (let at = 0; at === 0 || at < named.length; at += 1) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);
                named = seeded.holds;
                const hold = found(seeded.holds[at], "hold");
                const place = `the hold at ${hold}`;
                const before = yield* seeded.packs;

                const missing = yield* Effect.filter(
                  seeded.remoteIds,
                  (id) => Effect.map(Effect.result(seeded.repository.readCommit(id)), Result.isFailure),
                  { concurrency: 1 },
                );

                expect(missing.length, `${place}: the repository lacks the remote's commits`).toBeGreaterThan(0);

                const gate = yield* seeded.hold(hold);
                const fiber = yield* Effect.forkDetach(Effect.result(call(seeded, seeded.named, under, slot.layer)));

                const there = yield* Effect.raceFirst(
                  Effect.as(gate.reached, true),
                  Effect.as(Fiber.await(fiber), false),
                );

                expect(there, `${place}: the fetch reached it`).toBe(true);

                // The time limit fires while the fetch waits.
                yield* settle;
                yield* TestClock.adjust(Duration.seconds(time));
                yield* settle;

                if (hold === "read" || hold === "alternates") {
                  const result = yield* Fiber.join(fiber);
                  expect(Result.isFailure(result), `${place}: the call fails`).toBe(true);

                  if (Result.isFailure(result)) {
                    expectFailure(result.failure, Repository.TimedOut, {}, place);
                  }

                  for (const id of missing) {
                    const read = yield* Effect.result(seeded.repository.readCommit(id));
                    expect(Result.isFailure(read), `${place}: ${id} is still missing`).toBe(true);

                    if (Result.isFailure(read)) {
                      expect(Schema.is(Repository.NoSuchCommit)(read.failure), `${place}: ${id} is NoSuchCommit`).toBe(
                        true,
                      );
                    }
                  }

                  expect(yield* seeded.packs, `${place}: no pack file was added`).toEqual(before);
                } else {
                  expect(fiber.pollUnsafe(), `${place}: the adopt is not cut by the limit`).toBeUndefined();
                  yield* gate.open;
                  const result = yield* Fiber.join(fiber);
                  expect(Result.isSuccess(result), `${place}: the call answers`).toBe(true);

                  if (Result.isSuccess(result)) {
                    expect(result.success, `${place}: the refs`).toEqual(modelRefs(seeded, answered));
                  }

                  yield* readBack(seeded, scenario, answered, place);

                  const added = (yield* seeded.packs).filter(
                    (name) => !before.includes(name) && name.startsWith("pack-"),
                  );

                  for (const stem of new Set(added.map((name) => name.replace(/\.[^.]+$/, "")))) {
                    for (const kind of ["pack", "rev", "idx"]) {
                      expect(added, `${place}: ${stem} has its .${kind}`).toContain(`${stem}.${kind}`);
                    }
                  }

                  expect(yield* seeded.garbage, `${place}: git counts no garbage`).toBe(0);
                }

                places.push(hold);
              }),
            );
          }

          expect(places, "the carrier reached every hold its subject names").toEqual(named);
        }),
      run,
    );

    // Plant: fetch a named remote by passing its name as the URL, so git reads `origin` as a path, F3 red; treat an unknown name as a URL, so it
    // fails FetchFailed, red; map FetchFailed to `[]`, red; look a URL up among the names first, so an unnamed URL fails, red.
    it.effect.prop(
      "F3 by name or by URL: the remote by its name and by each URL answer the same; a name with no remote fails NoSuchRemote naming the name; a URL that reaches nothing fails FetchFailed naming the URL; neither is []",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const slot = yield* recorder(Option.none());
          const plain = carrier.attempts.filter((attempt) => attempt.scenario === "plain");
          const scenario = carrier.scenarios.plain;

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);

              for (const attempt of plain.filter((each) => each.via === "name")) {
                const byName = yield* Effect.result(call(seeded, seeded.named, attempt.under, slot.layer));
                expect(Result.isSuccess(byName), `${attempt.under}: by name it answers`).toBe(true);

                for (const url of seeded.urls) {
                  const byUrl = yield* Effect.result(call(seeded, url, attempt.under, slot.layer));
                  expect(byUrl, `${attempt.under}: by ${remoteText(url)}, the same answer as by name`).toEqual(byName);
                }
              }

              for (const attempt of plain.filter((each) => each.via === "unnamed" || each.via === "nowhere")) {
                const result = yield* Effect.result(
                  call(seeded, remoteFor(seeded, attempt, undefined), attempt.under, slot.layer),
                );

                expectOutcome(attempt.label, result, attempt, seeded);
              }
            }),
          );
        }),
      run,
    );

    // Plant: drop `--update-shallow`, and in memory leave out the refs that reach a cut, so the answer is `[]`, F4 red; check only the fetched
    // directory for a shallow local, so the transfer runs and fails FetchFailed, red; count with `>=`, so exactly the limit fails, red; answer
    // `[]` on HistoryTooShort, red.
    it.effect.prop(
      "F4 a fetch that cannot answer fails: a cut remote and a shallow local fail HistoryTooShort, the shallow local with no transfer and the repository as it was; one ref past limits.refs fails TooMany and exactly the limit answers; [] only where the remote holds no ref",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const slot = yield* recorder(Option.none());
          const kinds = new Set<string>();

          yield* eachAttempt(
            subject,
            carrier,
            (attempt) => attempt.scenario !== "plain",
            (seeded, _scenario, attempt) =>
              Effect.forEach(
                remoteForms(seeded, attempt),
                (remote) =>
                  Effect.gen(function* () {
                    const before = yield* seeded.fingerprint;
                    const result = yield* Effect.result(call(seeded, remote, attempt.under, slot.layer));
                    expectOutcome(attempt.label, result, attempt, seeded);
                    kinds.add(`${attempt.scenario}:${attempt.outcome.kind}`);

                    if (attempt.scenario === "shallow") {
                      expect(yield* seeded.fingerprint, `${attempt.label}: no transfer ran`).toEqual(before);
                    }
                  }),
                { concurrency: 1 },
              ),
          );

          expect([...kinds].sort(), "the law reached every kind").toEqual(
            ["cut:refs", "cut:too-short", "exact:refs", "past:too-many", "shallow:too-short"].sort(),
          );
        }),
      run,
    );

    // Plant: keep each answer by URL and `under` in the layer, so the second fetch gives the old commit, F5 red.
    it.effect.prop(
      "F5 no answer is kept: after the remote's ref moves, the second fetch answers the moved commit, and the commit it now names reads back",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const scenario = carrier.scenarios.plain;
          const slot = yield* recorder(Option.none());

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);
              const under = carrier.move.ref;

              const first = yield* call(seeded, seeded.named, under, slot.layer);
              const before = refsModel(scenario.remote, under);
              expect(first, "the first answer").toEqual(modelRefs(seeded, before));

              yield* seeded.moveRemoteRef(under, carrier.move.to);

              const second = yield* call(seeded, seeded.named, under, slot.layer);
              const moved = [{ name: under, commit: carrier.move.to }];
              expect(second, "the second answer is the moved commit").toEqual(modelRefs(seeded, moved));
              expect(second, "and not the first").not.toEqual(first);
              yield* readBack(seeded, scenario, moved, "after the move");
            }),
          );
        }),
      run,
    );

    // Plant: ask the slot once per layer (`Effect.cached`), so two fetches give one ask, F6 red; ask with the name text, red; fetch first and then ask,
    // so a failing slot leaves the store changed, red.
    it.effect.prop(
      "F6 the slot is asked once on every fetch with the URL: two fetches give two asks, each holding the URL of the remote (the configured one for a name); a slot that fails gives NoCredential, and the repository is as it was",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const scenario = carrier.scenarios.plain;
          const under = "refs/heads/main";

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);
              const slot = yield* recorder(Option.none());

              yield* call(seeded, seeded.named, under, slot.layer);
              expect(yield* slot.asked, "one fetch, one ask, with the configured URL").toEqual([seeded.configured]);

              yield* call(seeded, seeded.named, under, slot.layer);
              expect(yield* slot.asked, "two fetches, two asks").toEqual([seeded.configured, seeded.configured]);

              for (const url of seeded.urls) {
                yield* call(seeded, url, under, slot.layer);
              }

              expect(yield* slot.asked, "a URL is asked as it is").toEqual([
                seeded.configured,
                seeded.configured,
                ...seeded.urls.map(remoteText),
              ]);
            }),
          );

          // A repository that holds none of the remote's history, so a fetch that ran before the slot failed would have left objects in it.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(scenario.remote, EMPTY, scenario.settings);
              const refusing = yield* recorder("fails");
              const before = yield* seeded.fingerprint;
              const folders = yield* refsOfFolders(seeded);
              const error = yield* failed(call(seeded, seeded.named, under, refusing.layer), "a failing slot");
              expectFailure(error, Credentials.NoCredential, { url: seeded.configured }, "the slot failed");
              expect(yield* refusing.asked, "the slot was asked").toEqual([seeded.configured]);
              expect(yield* seeded.fingerprint, "the repository is as it was").toEqual(before);
              expect(yield* refsOfFolders(seeded), "the refs are as they were").toEqual(folders);
            }),
          );
        }),
      run,
    );

    // [secrets] Plant: annotate `git.fetch` with the user name, F7 red; `Effect.logDebug` the password in `make`, red; put the user name in
    // `FetchFailed.stderr` in memory, red; memory keeps the last credential in its cell, red.
    it.effect.prop(
      "F7 [secrets] the credential stays out of every output: with a drawn credential, across a fetch that answers, a name with no remote, a URL that reaches nothing, a cut remote and one ref past the limit, neither the user name nor the password is in any span, any log line, the answer, any failure or the memory store",
      { texture: textureArb, drawn: credentialArb },
      ({ texture, drawn }) =>
        Effect.gen(function* () {
          expect(drawn.classes, "the credential reaches every class").toEqual(CREDENTIAL_CLASSES);
          const carrier = fetchCarrier(texture);
          const slot = yield* recorder(Option.some(credentialFrom(drawn)));

          // Each secret as plain text, as the inside of a JSON string, as that again inside a JSON string, and percent-encoded: the forms a leak takes.
          const secrets = [drawn.username, drawn.password].flatMap((secret) => {
            const once = JSON.stringify(secret).slice(1, -1);

            return [secret, once, JSON.stringify(once).slice(1, -1), encodeURIComponent(secret)];
          });

          const logs: Array<string> = [];

          const logger = Logger.make((entry) => {
            logs.push(
              JSON.stringify([
                entry.message,
                shown(entry.fiber.getRef(References.CurrentLogAnnotations)),
                Cause.pretty(entry.cause),
              ]),
            );
          });

          const wanted = [
            "plain, name, refs/heads/main",
            "plain, nowhere",
            "plain, unnamed",
            "cut, name, refs/heads/main",
            "past, name, heads",
          ];

          const chosen = carrier.attempts.filter((attempt) => wanted.some((label) => attempt.label.startsWith(label)));
          expect(chosen.length, "the law holds every case").toBe(wanted.length);

          yield* eachAttempt(
            subject,
            carrier,
            (attempt) => chosen.includes(attempt),
            (seeded, _scenario, attempt) =>
              Effect.gen(function* () {
                const remote = remoteFor(seeded, attempt, undefined);

                const outcome = yield* traced(
                  Effect.result(call(seeded, remote, attempt.under, slot.layer)).pipe(
                    Effect.provide(Logger.layer([logger])),
                    Effect.provideService(References.MinimumLogLevel, "All"),
                  ),
                );

                const place = attempt.label;

                const texts = [
                  shown(outcome.answer),
                  Result.isFailure(outcome.answer) ? String(outcome.answer.failure) : "",
                  Result.isFailure(outcome.answer) ? Cause.pretty(Cause.fail(outcome.answer.failure)) : "",
                  shown(yield* seeded.fingerprint),
                  shown(outcome.spans.map((span) => [span.name, [...span.attributes], span.events, span.status])),
                  ...logs,
                ];

                for (const secret of secrets) {
                  for (const text of texts) {
                    expect(text.includes(secret), `${place}: no output holds the credential`).toBe(false);
                  }
                }

                expectNamedSpan(place, outcome.spans, "git.fetch", {}, [], [...secrets, ...seeded.hidden]);
              }),
          );
        }),
      run,
    );

    // Plant: put the URL in the span, F8 red; write `fetch` with `Effect.fnUntraced`, so there is no span, red; annotate the count before the call,
    // so the count is wrong, red.
    it.effect.prop(
      "F8 the span: each fetch makes one git.fetch, ended, with kalfa.git.remote, kalfa.git.under, kalfa.git.credential and, on an answer, kalfa.git.refs; no attribute holds the URL, the name or a path",
      { texture: textureArb },
      ({ texture }) =>
        Effect.gen(function* () {
          const carrier = fetchCarrier(texture);
          const scenario = carrier.scenarios.plain;
          const gives = credentialFrom({ username: "span-user", password: "span-password" });

          yield* Effect.scoped(
            Effect.gen(function* () {
              const seeded = yield* subject.seed(scenario.remote, scenario.local, scenario.settings);

              const secrets = [
                seeded.configured,
                "origin",
                ...seeded.urls.map(remoteText),
                ...seeded.hidden,
                "span-user",
                "span-password",
              ];

              const under = "refs/heads/main";

              for (const [label, slot, remote, credential] of [
                ["by name, no credential", yield* recorder(Option.none()), seeded.named, false],
                ["by URL, a credential", yield* recorder(Option.some(gives)), found(seeded.urls[0], "URL"), true],
              ] as const) {
                const made = yield* traced(Effect.result(call(seeded, remote, under, slot.layer)));
                expect(Result.isSuccess(made.answer), `${label}: it answers`).toBe(true);

                expectNamedSpan(
                  label,
                  made.spans,
                  "git.fetch",
                  {
                    "kalfa.git.remote": Predicate.isTagged(remote, "Named") ? "named" : "url",
                    "kalfa.git.under": under,
                    "kalfa.git.credential": credential,
                    "kalfa.git.refs": Result.isSuccess(made.answer) ? made.answer.success.length : -1,
                  },
                  [],
                  secrets,
                );
              }

              // A fetch that fails still ends its span, with no count of refs, and a slot that was never asked leaves no `kalfa.git.credential`.
              const lost = yield* traced(
                Effect.result(call(seeded, Remote.named(NOWHERE), under, (yield* recorder(Option.none())).layer)),
              );

              expect(Result.isFailure(lost.answer), "a name with no remote fails").toBe(true);

              expectNamedSpan(
                "a name with no remote",
                lost.spans,
                "git.fetch",
                { "kalfa.git.remote": "named", "kalfa.git.under": under },
                ["kalfa.git.refs", "kalfa.git.credential"],
                secrets,
              );
            }),
          );
        }),
      run,
    );
  });
};
