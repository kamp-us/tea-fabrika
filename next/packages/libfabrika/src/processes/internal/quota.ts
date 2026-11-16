import { Machine } from "@demlik/tea/effect";
import * as Arr from "effect/Array";
import * as Schema from "effect/Schema";
import { Exceeded, RecoveryReserveExhausted, type Allowance } from "../Quotas.ts";

const Amount = Schema.Struct({ writes: Schema.Number, bytes: Schema.Number });
const Decision = Schema.TaggedUnion({ admitted: {}, refused: { reason: Exceeded } });

/**
 * Schema for whose account one machine keeps: a `program`'s ledger account, a registered name's
 * `recovery` account at one storage location, or a name's Process-local `local` program account.
 * Code that charges a write picks it; it is never read from a name's text.
 *
 * @internal
 */
export const Account = Schema.TaggedUnion({
  program: { program: Schema.String },
  recovery: { name: Schema.String, location: Schema.Literals(["project", "process"]) },
  local: { name: Schema.String },
});

/** @internal */
export type Account = typeof Account.Type;

const Fields = {
  account: Account,
  at: Schema.Number,
  writes: Schema.Number,
  bytes: Schema.Number,
  total: Amount,
  ahead: Amount,
  groups: Schema.Array(Schema.Struct({ at: Schema.Number, ...Amount.fields })),
  replay: Schema.Struct({ recovery: Schema.String, messages: Schema.Array(Schema.String) }),
  decision: Decision,
};

/** @internal */
export const Model = Schema.TaggedUnion({
  ready: Fields,
  reserve_fault: { ...Fields, fault: RecoveryReserveExhausted, operation: Schema.String },
});

/** @internal */
export type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("propose"),
    at: Schema.Number,
    operation: Schema.String,
    ...Amount.fields,
    ahead: Amount,
    replay: Schema.optionalKey(Schema.Struct({ message: Schema.String, recovery: Schema.String })),
  }),
  Schema.Struct({ type: Schema.Literal("advance"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("resume"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("restore"), model: Model }),
  Schema.Struct({ type: Schema.Literal("settle"), bytes: Schema.Number, ahead: Amount }),
]);

/** @internal */
export type Msg = typeof Msg.Type;

const advance = (s: Model, at: number): Model => {
  const now = Math.max(s.at, at);
  const groups = Arr.filter(s.groups, (g) => g.at > now - 60_000);
  return {
    ...s,
    writes: Arr.reduce(groups, 0, (n, g) => n + g.writes),
    bytes: s.account._tag === "recovery" ? Arr.reduce(groups, 0, (n, g) => n + g.bytes) : s.bytes,
  };
};

/** @internal */
export const make = (options: { readonly account: Account; readonly limits: Allowance }) =>
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (saved) => [
      saved ??
        Model.cases.ready.make({
          account: options.account,
          at: 0,
          writes: 0,
          bytes: 0,
          ahead: { writes: 0, bytes: 0 },
          total: { writes: 0, bytes: 0 },
          groups: [],
          replay: { recovery: "", messages: [] },
          decision: Decision.cases.admitted.make({}),
        }),
      [],
    ],
    update: {
      restore: (_s, m) => [m.model, []],
      settle: (s, m) => [
        {
          ...s,
          bytes: s.bytes + m.bytes - m.ahead.bytes,
          total: { ...s.total, bytes: s.total.bytes + m.bytes },
          ahead: { writes: s.ahead.writes - m.ahead.writes, bytes: s.ahead.bytes - m.ahead.bytes },
          decision: Decision.cases.admitted.make({}),
        },
        [],
      ],
      advance: (s, m) => [advance(s, m.at), []],
      resume: (s, m) => {
        const { _tag: _case, ...fields } = advance(s, m.at);
        return [Model.cases.ready.make(fields), []];
      },
      propose: (previous, m) => {
        const s = advance(previous, m.at);

        if (s._tag === "reserve_fault") {
          return [s, []];
        }

        const account = s.account;
        const replay =
          m.replay !== undefined &&
          (s.replay.recovery !== m.replay.recovery || !s.replay.messages.includes(m.replay.message)) &&
          m.writes <= options.limits.message.writes &&
          Math.max(0, m.bytes) <= options.limits.message.bytes;
        const writes = replay ? 0 : m.writes + m.ahead.writes;
        const bytes = replay ? 0 : Math.max(0, m.bytes + m.ahead.bytes);
        const usedWrites = s.writes + writes;
        const usedBytes = account._tag === "recovery" ? s.bytes + bytes : s.bytes + m.bytes + m.ahead.bytes;
        const resource = usedWrites > options.limits.writes ? "writes" : "storage";
        const exceeded =
          account._tag !== "local" && (usedWrites > options.limits.writes || usedBytes > options.limits.bytes);

        if (exceeded) {
          if (account._tag === "recovery") {
            const { _tag: _case, ...fields } = s;
            return [
              Model.cases.reserve_fault.make({
                ...fields,
                operation: m.operation,
                fault: new RecoveryReserveExhausted({
                  resource,
                  location: account.location,
                  process: account.name,
                  required: resource === "writes" ? writes : bytes,
                  remaining: resource === "writes" ? options.limits.writes - s.writes : options.limits.bytes - s.bytes,
                  cause: null,
                }),
              }),
              [],
            ];
          }

          return [
            {
              ...s,
              decision: Decision.cases.refused.make({
                reason: new Exceeded({
                  resource,
                  used: resource === "writes" ? usedWrites : usedBytes,
                  limit: resource === "writes" ? options.limits.writes : options.limits.bytes,
                  cause: null,
                }),
              }),
            },
            [],
          ];
        }

        if (m.writes === 0 && m.bytes === 0 && m.ahead.writes === 0 && m.ahead.bytes === 0) {
          return [{ ...s, decision: Decision.cases.admitted.make({}) }, []];
        }

        const at = Math.max(s.at, m.at);
        const groups = Arr.filter(s.groups, (g) => g.at > at - 60_000);
        const last = groups.at(-1);

        if (writes !== 0 || bytes !== 0) {
          if (last?.at === at) {
            groups[groups.length - 1] = { at, writes: last.writes + writes, bytes: last.bytes + bytes };
          } else {
            groups.push({ at, writes, bytes });
          }
        }

        return [
          {
            ...s,
            at,
            groups,
            writes: usedWrites,
            bytes: usedBytes,
            total: { writes: s.total.writes + m.writes, bytes: s.total.bytes + m.bytes },
            ahead: { writes: s.ahead.writes + m.ahead.writes, bytes: s.ahead.bytes + m.ahead.bytes },
            replay:
              replay && m.replay !== undefined
                ? {
                    recovery: m.replay.recovery,
                    messages: [...(s.replay.recovery === m.replay.recovery ? s.replay.messages : []), m.replay.message],
                  }
                : s.replay,
            decision: Decision.cases.admitted.make({}),
          },
          [],
        ];
      },
    },
  });
