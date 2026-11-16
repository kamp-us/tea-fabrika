import { Cmd, Machine } from "@demlik/tea/effect";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Decision, Policy } from "../RateLimit.ts";

const Integer = Schema.Int.check(
  Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
);

const Positive = Integer.check(Schema.isGreaterThan(0));

/** @internal The saved budget schema retains its synchronous codecs. */
export const Model = Schema.TaggedUnion({
  fresh: {},
  open: { policy: Policy, until: Integer, at: Integer, used: Positive },
  full: { policy: Policy, until: Integer, at: Integer },
}).check(
  Schema.makeFilter((s) =>
    Match.valueTags(s, {
      fresh: () => true,
      open: ({ policy, until, at, used }) => until > at && used < policy.limit,
      full: ({ until, at }) => until > at,
    }),
  ),
);

const fresh = Model.isAnyOf(["fresh"]);

const full = Model.isAnyOf(["full"]);

const open = Model.isAnyOf(["open"]);

const Msg = Schema.Struct({ type: Schema.Literal("take"), at: Integer, policy: Policy });

const report = Cmd.make("report", { input: Schema.Struct({ decision: Decision }), ok: Schema.Null, err: [] });

const times = Schema.decodeUnknownResult(Schema.Struct({ at: Integer, until: Integer, ttl: Positive }));

/** @internal One sender's saved budget. Time and policy enter only in a take message. */
export const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [report],
  init: (loaded) => [loaded ?? Model.cases.fresh.make({}), []],
  update: {
    take: (s, m) => {
      const live = !fresh(s) && m.at < s.until;
      const at = live ? Math.max(m.at, s.at) : m.at;
      const same = !fresh(s) && s.policy.limit === m.policy.limit && s.policy.window === m.policy.window;
      const continuing = live && same;
      const until = continuing ? s.until : (Math.floor(at / m.policy.window) + 1) * m.policy.window;
      const checked = times({ at, until, ttl: until - at });

      if (Result.isFailure(checked)) {
        return [s, [report({ decision: Decision.cases.invalid.make({ cause: checked.failure }) })]];
      }

      const { ttl } = checked.success;

      if (continuing && full(s)) {
        return [
          Model.cases.full.make({ policy: m.policy, until, at }),
          [report({ decision: Decision.cases.refused.make({ retryAfter: ttl }) })],
        ];
      }

      const used = continuing && open(s) ? s.used + 1 : 1;

      const next =
        used === m.policy.limit
          ? Model.cases.full.make({ policy: m.policy, until, at })
          : Model.cases.open.make({ policy: m.policy, until, at, used });

      return [next, [report({ decision: Decision.cases.allowed.make({ count: used, ttl }) })]];
    },
    report_ok: (s) => [s, []],
    report_err: (s) => [s, []],
  },
});
