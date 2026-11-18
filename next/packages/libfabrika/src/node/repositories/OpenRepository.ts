/**
 * Opening a selected repository on Node: read and check it before the instance starts, then record
 * the selection and the person's trust answer once there is a ledger.
 */
import * as Files from "@kalfa/config/Files";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Function from "effect/Function";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";

import * as Id from "../../Id.ts";
import * as Log from "../../ledger/Log.ts";
import * as Open from "../../packs/Open.ts";
import { Event, RepositoryId, RepositoryTrust, TrustDecision } from "../../packs/RepositoryTrust.ts";
import { Repositories } from "../../repositories/Repositories.ts";
import * as Declarations from "../../settings/Declarations.ts";
import * as Load from "../settings/Load.ts";

class Storage extends Schema.TaggedError<Storage, { readonly brand: unique symbol }>()("Storage", {
  cause: Schema.Defect(),
}) {}

class InvalidDocument extends Schema.TaggedError<InvalidDocument, { readonly brand: unique symbol }>()(
  "InvalidDocument",
  { cause: Schema.Defect() },
) {}

class ReadFailed extends Schema.TaggedError<ReadFailed, { readonly brand: unique symbol }>()("ReadFailed", {
  cause: Schema.Defect(),
}) {}

class OpenRepositoryError extends Schema.TaggedError<OpenRepositoryError, { readonly brand: unique symbol }>()(
  "OpenRepositoryError",
  {
    reason: Schema.Union([Storage, InvalidDocument, ReadFailed]),
    message: Schema.String,
  },
) {}

const failed = (reason: "storage" | "document" | "read", cause: unknown, message?: string) =>
  OpenRepositoryError.make({
    reason: Match.value(reason)
      .pipe(
        Match.when("storage", () => Storage),
        Match.when("document", () => InvalidDocument),
        Match.orElse(() => ReadFailed),
      )
      .make({ cause: Redacted.make(cause) }),
    message:
      message ??
      Match.value(reason).pipe(
        Match.when("document", () => "Selected repository: settings document is invalid."),
        Match.when("read", () => "Selected repository: read failed."),
        Match.orElse(() => "Selected repository: trust could not be saved."),
      ),
  });

// A settings error's messages can include rejected values and parser input. Keep only known labels and keys.
const documentFailed = (cause: Files.SettingsError) => {
  const labels = [
    ".fabrika/fabrika.toml",
    "~/.fabrika/fabrika.toml",
    "$FABRIKA_HOME/fabrika.toml",
    ...Arr.flatMap(Declarations.all.declarations, (d) => [`--${d.path}`, d.env]),
  ];

  const label = Option.getOrUndefined(
    Arr.findFirst(labels, (name) =>
      Arr.some([":", ", line ", " could not be read."], (suffix) =>
        Function.pipe(cause.message, Str.startsWith(`${name}${suffix}`)),
      ),
    ),
  );

  const line =
    label === undefined
      ? undefined
      : /^, line ([0-9]+):/.exec(Function.pipe(cause.message, Str.slice(label.length)))?.[1];

  const location = label === undefined ? "Settings" : `${label}${line === undefined ? "" : `, line ${line}`}`;
  const detail = label === undefined ? "" : Function.pipe(cause.message, Str.slice(location.length + 2));

  const keys = Arr.flatMap(Declarations.all.declarations, (d) =>
    Arr.map(d.segments, (_, n) => Arr.join(d.segments.slice(0, n + 1), ".")),
  );

  const key =
    cause.reason === "version"
      ? Declarations.version.path
      : Option.getOrUndefined(
          Arr.findFirst(
            keys,
            (name) =>
              Function.pipe(detail, Str.startsWith(`${name} =`)) ||
              Function.pipe(detail, Str.startsWith(`${name} is `)),
          ),
        );

  const explanation = {
    syntax: "Invalid TOML.",
    unknown: "Unknown setting. Run fabrika settings to list the allowed keys.",
    scope: "This setting is not allowed in this file.",
    invalid: "Invalid setting value. Run fabrika settings to see the allowed values.",
    version: "This repository requires a newer fabrika version.",
    read: "Settings could not be read.",
  }[cause.reason];

  return failed(
    "document",
    cause,
    `${location}${key === undefined ? "" : `: ${key}`}: ${explanation}\n  ${Files.STOP}`,
  );
};

/**
 * Reads a selected repository and loads its settings, before any instance starts: it opens the
 * clone at `location`, takes its snapshot and resolves the settings from that snapshot's document
 * with the person's file, the flags and the environment.
 *
 * **Details**
 *
 * It resolves no source folder and loads no code. A failure carries a message for the person. A
 * settings failure names the file, the line and the key, never the rejected value.
 *
 * @category constructors
 */
export const prepare = Effect.fn("repositoryOpen.prepare")(function* (
  location: string,
  options: Omit<Parameters<typeof Load.load>[0], "repo">,
) {
  const repository = yield* (yield* Repositories)
    .open(location)
    .pipe(
      Effect.mapError((cause) =>
        failed(
          "read",
          cause,
          Option.getOrUndefined(
            Arr.findFirst(
              [
                "fabrika.toml moved to .fabrika/fabrika.toml: move it there",
                ".fabrika.jsonc moved to [review] in .fabrika/fabrika.toml: move it there",
              ],
              (message) => message === cause.message,
            ),
          ),
        ),
      ),
    );

  const loaded = yield* Load.load({
    ...options,
    repo: { name: repository.snapshot.file, text: repository.snapshot.text },
  }).pipe(Effect.mapError(documentFailed));

  const { text, ...snapshot } = repository.snapshot;

  return { snapshot: { ...snapshot, present: text !== null }, settings: loaded.snapshot, values: loaded.values };
});

/**
 * Records a prepared selection on the ledger and settles whether the person trusts it. It answers
 * the opening's last state: `ready`, `refused` or `awaiting_trust`.
 *
 * **Details**
 *
 * It writes `selected`, then reuses the person's last saved decision for this clone when there is
 * one. With none, an interactive call asks `confirm` once and writes the `decision`; a call that is
 * not interactive stops at `awaiting_trust` and writes nothing more. An accepted or a denied
 * selection ends with an `opened` event. Who is asking (`actor`, `by` and `build`) comes from the
 * instance's options, never from the repository's document or the terminal answer.
 *
 * @category constructors
 */
export const open = Effect.fn("repositoryOpen.open")(function* <E, R>(
  prepared: Effect.Success<ReturnType<typeof prepare>>,
  options: {
    readonly selection: Id.InputId;
    readonly request: Id.InputId;
    readonly actor: typeof Id.Person.Type;
    readonly by: string;
    readonly build: string;
    readonly interactive: boolean;
    readonly confirm: (selection: Open.CheckedSelection) => Effect.Effect<boolean, E, R>;
  },
) {
  const trust = yield* RepositoryTrust;
  const session = yield* Open.session();
  const selection = options.selection;
  yield* session.send({ type: "select", selection });

  const history = yield* trust
    .history(prepared.snapshot.key, options.actor)
    .pipe(Effect.mapError((cause) => failed("storage", cause)));

  const first = Option.getOrUndefined(Arr.findFirst(history, (event) => event._tag === "selected"));

  const repository =
    first?.repository ??
    (yield* Id.Generator.use((ids) => ids.next(RepositoryId)).pipe(
      Effect.provide(Id.Generator.layer),
      Effect.mapError((cause) => failed("storage", cause)),
    ));

  const snapshot: Open.CheckedSelection = {
    ...prepared.snapshot,
    repository,
    label: `Repository ${Function.pipe(prepared.snapshot.key, Str.slice(0, 12))}`,
    settings: prepared.settings,
    person: options.actor,
  };

  const selected = Event.cases.selected.make({ ...snapshot, request: selection });
  const from = yield* Log.fromHere({ by: options.by, for: options.actor, seen: 0, parent: null, build: options.build });
  // A retry keeps the same append id; the ledger retains the first placing's writer clock and trace.
  const placed = yield* trust.write(selected, from).pipe(Effect.mapError((cause) => failed("storage", cause)));
  const answerFrom = { ...from, seen: placed.rev, parent: selection };
  yield* session.send({ type: "checked", selection, snapshot });
  let state = yield* session.send({ type: "history", selection, events: history });

  if (state._tag === "awaiting_trust") {
    if (!options.interactive) {
      return state;
    }

    const accepted = yield* options.confirm(snapshot).pipe(Effect.mapError((cause) => failed("storage", cause)));
    const decision = accepted ? TrustDecision.cases.accepted.make({}) : TrustDecision.cases.denied.make({});
    yield* trust
      .write(
        Event.cases.decision.make({
          repository,
          key: snapshot.key,
          selection,
          request: options.request,
          commit: snapshot.commit,
          hash: snapshot.hash,
          decision,
          actor: options.actor,
          method: "terminal",
        }),
        { ...answerFrom, sentAt: DateTime.formatIso(yield* DateTime.now) },
      )
      .pipe(Effect.mapError((cause) => failed("storage", cause)));
    state = yield* session.send({ type: "answer", selection, request: options.request, decision });
  }

  if (state._tag !== "saving" && !(state._tag === "refused" && state.reason === "denied")) {
    return state;
  }

  const accepted = state._tag === "saving" && state.decision._tag === "accepted";

  const receipt = yield* trust
    .write(
      Event.cases.opened.make({
        repository,
        key: snapshot.key,
        selection,
        request: selection,
        commit: snapshot.commit,
        hash: snapshot.hash,
        settings: snapshot.settings,
        result: accepted ? "ready" : "refused",
        ...(accepted ? {} : { reason: "denied" as const }),
      }),
      { ...answerFrom, sentAt: DateTime.formatIso(yield* DateTime.now) },
    )
    .pipe(Effect.mapError((cause) => failed("storage", cause)));

  return state._tag === "saving"
    ? yield* session.send({ type: "saved", selection, request: state.request, receipt })
    : state;
});
