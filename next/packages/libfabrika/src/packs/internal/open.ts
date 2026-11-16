import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import * as Id from "../../Id.ts";
import { Branch, Hash, ObjectId } from "../../repositories/Repositories.ts";
import { Snapshot } from "../../settings/Snapshot.ts";
import { Event, Receipt, RepositoryId, TrustDecision } from "../RepositoryTrust.ts";

/** @internal */
export { Receipt } from "../RepositoryTrust.ts";

/** @internal */
export const CheckedSelection = Schema.Struct({
  repository: RepositoryId,
  key: Hash,
  label: Schema.NonEmptyString,
  branch: Branch,
  commit: ObjectId,
  hash: Hash,
  present: Schema.Boolean,
  settings: Snapshot,
  person: Id.Person,
});

/** @internal */
export type CheckedSelection = typeof CheckedSelection.Type;

/** @internal */
export const Refusal = Schema.Literals(["denied", "storage", "invalid_document", "read_failed", "invalid_history"]);

const checking = { selection: Id.InputId, snapshot: Schema.NullOr(CheckedSelection) };

const selected = { selection: Id.InputId, snapshot: CheckedSelection };

const State = Schema.TaggedUnion({
  closed: {},
  checking,
  awaiting_trust: selected,
  saving: { ...selected, request: Id.InputId, decision: TrustDecision },
  ready: { ...selected, receipt: Receipt },
  refused: { selection: Id.InputId, reason: Refusal },
});

type State = typeof State.Type;

const decided = Event.isAnyOf(["decision"]);

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("select"), selection: Id.InputId }),
  Schema.Struct({ type: Schema.Literal("checked"), ...selected }),
  Schema.Struct({ type: Schema.Literal("history"), selection: Id.InputId, events: Schema.Array(Event) }),
  Schema.Struct({
    type: Schema.Literal("answer"),
    selection: Id.InputId,
    request: Id.InputId,
    decision: TrustDecision,
  }),
  Schema.Struct({ type: Schema.Literal("saved"), selection: Id.InputId, request: Id.InputId, receipt: Receipt }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    selection: Id.InputId,
    request: Schema.optionalKey(Id.InputId),
    reason: Refusal,
  }),
  Schema.Struct({ type: Schema.Literal("close") }),
]);

/** @internal */
export const machine = Machine.make({
  model: State,
  msg: Msg,
  cmds: [],
  init: () => [State.cases.closed.make({}), []],
  update: {
    select: (_s, m) => [State.cases.checking.make({ selection: m.selection, snapshot: null }), []],
    checked: (s, m) =>
      State.isAnyOf(["checking"])(s) && s.snapshot === null && s.selection === m.selection
        ? [State.cases.checking.make({ selection: s.selection, snapshot: m.snapshot }), []]
        : [s, []],
    history: (s, m) => {
      if (!State.isAnyOf(["checking"])(s) || s.selection !== m.selection || s.snapshot === null) {
        return [s, []];
      }

      const snapshot = s.snapshot;
      let decision: TrustDecision | undefined;
      const selections = new Map<Id.InputId, typeof Event.cases.selected.Type>();

      for (const event of m.events) {
        if (event.key !== snapshot.key || event.repository !== snapshot.repository) {
          return [State.cases.refused.make({ selection: s.selection, reason: "invalid_history" }), []];
        }

        if (Event.isAnyOf(["selected"])(event)) {
          selections.set(event.request, event);
        } else {
          const selected = selections.get(event.selection);

          if (
            selected === undefined ||
            selected.commit !== event.commit ||
            selected.hash !== event.hash ||
            (decided(event) && event.actor !== snapshot.person)
          ) {
            return [State.cases.refused.make({ selection: s.selection, reason: "invalid_history" }), []];
          }

          if (decided(event)) {
            decision = event.decision;
          }
        }
      }

      if (decision === undefined) {
        return [State.cases.awaiting_trust.make({ selection: s.selection, snapshot }), []];
      }

      return TrustDecision.match(decision, {
        accepted: (accepted): readonly [State, []] => [
          State.cases.saving.make({ selection: s.selection, snapshot, request: s.selection, decision: accepted }),
          [],
        ],
        denied: (): readonly [State, []] => [
          State.cases.refused.make({ selection: s.selection, reason: "denied" }),
          [],
        ],
      });
    },
    answer: (s, m) =>
      State.isAnyOf(["awaiting_trust"])(s) && s.selection === m.selection
        ? [
            State.cases.saving.make({
              selection: s.selection,
              snapshot: s.snapshot,
              request: m.request,
              decision: m.decision,
            }),
            [],
          ]
        : [s, []],
    saved: (s, m) => {
      if (!State.isAnyOf(["saving"])(s) || s.selection !== m.selection || s.request !== m.request) {
        return [s, []];
      }

      return [
        TrustDecision.match(s.decision, {
          accepted: (): State =>
            State.cases.ready.make({ selection: s.selection, snapshot: s.snapshot, receipt: m.receipt }),
          denied: (): State => State.cases.refused.make({ selection: s.selection, reason: "denied" }),
        }),
        [],
      ];
    },
    failed: (s, m) => {
      if (
        State.isAnyOf(["closed", "ready", "refused"])(s) ||
        s.selection !== m.selection ||
        (State.isAnyOf(["saving"])(s) && m.request !== s.request)
      ) {
        return [s, []];
      }

      return [State.cases.refused.make({ selection: s.selection, reason: m.reason }), []];
    },
    close: () => [State.cases.closed.make({}), []],
  },
});
