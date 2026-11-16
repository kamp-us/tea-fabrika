// next/, ticket 887, P21 slice 1. Each plant named here runs after Menu.ts exists.
import { arbGuidedSequence, foldEvents, propertyInvariant, propertyTrace } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as fc from "fast-check";
import * as Declarations from "../settings/Declarations.ts";
import * as Test from "./Menu.test-support.ts";
import * as Menu from "./Menu.ts";
import { PersonCheck } from "./PersonCheck.ts";
import * as PersonCheckTest from "./PersonCheckTest.ts";

const options = (numRuns: number) => ({ seed: Test.seed, numRuns });

const signed = (cmds: ReadonlyArray<Test.Command>) =>
  cmds.filter(
    (c): c is Extract<Test.Command, { type: "sign_grant" | "sign_revoke" }> =>
      c.type === "sign_grant" || c.type === "sign_revoke",
  );

const waiting = (s: Test.Model) =>
  Menu.view(s).filter((i): i is Extract<typeof Menu.Item.Type, { _tag: "waiting" }> =>
    Menu.Item.isAnyOf(["waiting"])(i),
  );

// Menu.ts keeps its Model schema private, so a law matches a model with Effect's Match (0567, point 2).
const idle = (m: Test.Model) => Match.valueTags(m, { idle: () => true, checking: () => false });

const safe = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, "");

// pinned: amendment A-Lint uses the existing brain-line text cap, in UTF-16 code units.
const labelLimit = 256;

const displayed = (raw: string) => {
  const cut = safe(raw).slice(0, labelLimit);

  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

const hasLabel = (words: string, raw: string) => {
  const clean = safe(raw);
  const shown = displayed(raw);
  const next = clean.codePointAt(shown.length);

  return (
    !/[\uD800-\uDFFF]/u.test(words) &&
    words.includes(shown) &&
    (next === undefined || !words.includes(shown + String.fromCodePoint(next)))
  );
};

const hasCode = (words: string, code: string) => words.replace(/\s/g, "").includes(code);

// After build: sign on approve, approve on Enter, or accept a checked reply with the wrong cmd.
it("L1: signatures follow the matching check; no check failure or Enter writes", () => {
  propertyTrace(
    Test.machine,
    Test.ctx,
    Test.walks,
    (steps, _final, initCmds) => {
      if (signed(initCmds).length > 0) {
        return "init signed without a checked person";
      }

      const pending = new Set(initCmds.flatMap((c) => (c.type === "check" ? [c.cmd] : [])));

      for (const { prev, msg, next, cmds } of steps) {
        if (msg.type === "enter" && (!Test.same(prev, next) || cmds.length > 0)) {
          return "Enter acted";
        }

        if (msg.type === "not_checked") {
          const stale = Match.valueTags(prev, { idle: () => true, checking: ({ cmd }) => msg.cmd !== cmd });

          if (cmds.length > 0 || (stale ? !Test.same(prev, next) : !idle(next))) {
            return "a failed check acted";
          }
        }

        if (
          msg.type === "checked" &&
          Match.valueTags(prev, { idle: () => true, checking: ({ cmd }) => msg.cmd !== cmd }) &&
          (!Test.same(prev, next) || cmds.length > 0)
        ) {
          return "a stale check acted";
        }

        // Live-pass grants are checked separately by L6. A rows message can never revoke.
        const writes = signed(cmds).filter((c) => msg.type !== "rows" || c.type === "sign_revoke");

        if (
          writes.length > 0 &&
          !(
            msg.type === "checked" &&
            Match.valueTags(prev, { idle: () => false, checking: ({ cmd }) => msg.cmd === cmd }) &&
            pending.has(msg.cmd) &&
            writes.length === 1 &&
            idle(next)
          )
        ) {
          return "a signature had no matching check command";
        }

        if (msg.type === "checked" || msg.type === "not_checked") {
          pending.delete(msg.cmd);
        }

        for (const command of cmds) {
          if (command.type === "check") {
            pending.add(command.cmd);
          }
        }
      }

      return true;
    },
    options(300),
  );
});

// After build: look up the current row instead of act.shown; erase approve/remove's distinction.
it("L2: the signature keeps the clicked row, capabilities and act across later row changes", () => {
  propertyInvariant(
    Test.machine,
    Test.ctx,
    Test.walks,
    ({ prev, msg, next, cmds }) => {
      if (idle(prev) && (msg.type === "approve" || msg.type === "remove")) {
        const shown =
          msg.type === "approve"
            ? prev.rows.find((r) => r.key === msg.key)
            : prev.clients.find((c) => c.key === msg.key && !c.own);

        return (
          shown === undefined ||
          Match.valueTags(next, {
            idle: () => false,
            checking: ({ act, cmd }) =>
              act._tag === msg.type &&
              act.key === shown.key &&
              cmds.length === 1 &&
              cmds[0]?.type === "check" &&
              cmds[0].cmd === msg.cmd &&
              cmd === msg.cmd &&
              Test.same(act.shown, shown),
          }) ||
          "click did not capture its row"
        );
      }

      const held = Match.valueTags(prev, { idle: () => null, checking: (p) => p });

      if (held === null) {
        return true;
      }

      if (msg.type === "rows" || msg.type === "clients") {
        return (
          Match.valueTags(next, {
            idle: () => false,
            checking: ({ act, cmd }) => Test.same(act, held.act) && cmd === held.cmd,
          }) || "news replaced the clicked row"
        );
      }

      if (msg.type !== "checked" || msg.cmd !== held.cmd) {
        return true;
      }

      const [command] = signed(cmds);

      return Match.valueTags(held.act, {
        approve: (act) =>
          (signed(cmds).length === 1 &&
            command?.type === "sign_grant" &&
            command.key === act.key &&
            command.as === act.as &&
            Test.same(command.saw, {
              code: act.shown.code,
              label: act.shown.label,
              location: act.shown.location,
              method: "compare",
              check: msg.check,
              has: act.shown.has,
            })) ||
          "grant did not sign the clicked row",
        remove: (act) =>
          (signed(cmds).length === 1 &&
            command?.type === "sign_revoke" &&
            command.key === act.key &&
            command.saw.label === act.shown.label &&
            command.saw.location === act.shown.location &&
            command.saw.check === msg.check) ||
          "remove did not sign the clicked client",
      });
    },
    options(300),
  );
});

// After build: ask for a finger on Deny, or repeat a waiting item once per tab.
it("L3: Deny writes once without a finger in both states, and tabs share one waiting item", () => {
  propertyInvariant(
    Test.machine,
    Test.ctx,
    Test.walks,
    ({ prev, msg, next, cmds }) => {
      const items = waiting(next);

      if (
        new Set(items.map((i) => i.key)).size !== items.length ||
        next.rows.some((r) => items.filter((i) => i.key === r.key).length !== 1)
      ) {
        return "tabs split a waiting key into multiple items";
      }

      if (msg.type !== "deny") {
        return true;
      }

      const row = prev.rows.find((r) => r.key === msg.key);

      if (row === undefined) {
        return cmds.length === 0 || "an unknown row was denied";
      }

      const [command] = cmds;

      return (
        (cmds.length === 1 &&
          command?.type === "deny" &&
          command.key === row.key &&
          Test.same(command.saw, {
            code: row.code,
            label: row.label,
            location: row.location,
            has: row.has,
            method: "compare",
            check: "none",
          }) &&
          Match.valueTags(prev, {
            idle: () => true,
            checking: (p) => Match.valueTags(next, { idle: () => false, checking: (n) => Test.same(n.act, p.act) }),
          })) ||
        "Deny asked for a check or lost the pending act"
      );
    },
    options(200),
  );
});

// After build: offer Remove on own, or let an own key reach check.
it("L4: the app's own client stays visible and cannot be removed", () => {
  propertyInvariant(
    Test.machine,
    Test.ctx,
    Test.walks,
    ({ prev, msg, next, cmds }) => {
      for (const own of next.clients.filter((c) => c.own)) {
        const item = Menu.view(next).find((i) => Menu.Item.isAnyOf(["client"])(i) && i.key === own.key);

        if (item?._tag !== "client" || item.removable) {
          return "the own client is missing or removable";
        }
      }

      return (
        msg.type !== "remove" ||
        !prev.clients.some((c) => c.own && c.key === msg.key) ||
        (cmds.length === 0 && Test.same(prev, next)) ||
        "Remove acted on the own client"
      );
    },
    options(200),
  );
});

// After build: issue a second check or replace the first act while a check waits.
it("L5: one pending check blocks a second click and marks other rows busy in words", () => {
  propertyInvariant(
    Test.machine,
    Test.ctx,
    Test.walks,
    ({ prev, msg, next, cmds }) => {
      if (!idle(prev) && (msg.type === "approve" || msg.type === "remove")) {
        return (cmds.length === 0 && Test.same(prev, next)) || "a second click replaced the pending act";
      }

      const held = Match.valueTags(next, { idle: () => null, checking: (n) => n });

      if (held !== null) {
        return (
          Menu.view(next).every(
            (i) =>
              !Menu.Item.isAnyOf(["waiting", "client"])(i) ||
              i.key === held.act.key ||
              (i.busy && /busy|checking|waiting|in progress/i.test(i.words)),
          ) || "a second row does not explain that a check is pending"
        );
      }

      return true;
    },
    options(200),
  );
});

// After build: reuse a pass, ignore until, or trust a digest that came only from rows.
it("L6: only a matching opened reply creates a pass, live passes sign once, expired passes are ordinary rows", () => {
  propertyTrace(
    Test.machine,
    Test.ctx,
    Test.walks,
    (steps) => {
      const pending = new Set<string>();
      const passes = new Map<string, number>();

      for (const { msg, next, cmds } of steps) {
        if (msg.type === "opened" && pending.delete(msg.cmd)) {
          passes.set(msg.digest, msg.at + Test.ttl);
        }

        if (msg.type === "rows") {
          for (const [digest, until] of passes) {
            if (until <= msg.at) {
              passes.delete(digest);
            }
          }

          const expected: Array<{ key: string; as: Test.Row["as"]; saw: unknown }> = [];

          for (const row of msg.rows) {
            if (row.pass !== null && passes.has(row.pass)) {
              passes.delete(row.pass);
              expected.push({
                key: row.key,
                as: row.as,
                saw: {
                  code: row.code,
                  label: row.label,
                  location: row.location,
                  has: row.has,
                  method: "link",
                  check: "none",
                },
              });
            }
          }

          const actual = cmds.flatMap((c) => (c.type === "sign_grant" ? [{ key: c.key, as: c.as, saw: c.saw }] : []));

          if (!Test.same(actual, expected) || cmds.some((c) => c.type === "check")) {
            return "a missing, spent or expired pass signed, or a live pass asked for a finger";
          }

          for (const row of msg.rows.filter((r) => !expected.some((e) => e.key === r.key))) {
            if (!waiting(next).some((i) => i.key === row.key)) {
              return "a normal row disappeared after a spent, expired or unknown digest";
            }
          }
        }

        for (const command of cmds) {
          if (command.type === "open") {
            pending.add(command.cmd);
          }
        }

        if (!Test.same([...next.passes].map((p) => [p.digest, p.until]).sort(), [...passes].sort())) {
          return "the model holds a pass without a matching pending open";
        }
      }

      return true;
    },
    options(300),
  );
});

// After build: spread opened's secret into a pass, an item's words, and a Cmd, one output per plant.
it.effect.prop(
  "L7 [secrets]: the encoded model, every item and every Cmd keep only link digests",
  {
    text: Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(64)),
    bytes: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))).check(
      Schema.isMinLength(24),
      Schema.isMaxLength(48),
    ),
    draw: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xfffffff })),
  },
  ({ text, bytes, draw }) =>
    Effect.gen(function* () {
      const secret = `made-up-link-secret:${text}:${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      const raw = new TextEncoder().encode(secret);
      const digest = yield* Digest.Digest;
      const hash = yield* digest.digestHex(Digest.sha256, raw);

      const flows = Test.walks.map((messages) =>
        messages.map((msg) =>
          msg.type === "opened"
            ? { ...msg, digest: hash, secret, bytes: Array.from(raw) }
            : msg.type === "rows"
              ? { ...msg, rows: msg.rows.map((r) => ({ ...r, pass: r.pass === null ? null : hash })) }
              : msg,
        ),
      );

      propertyTrace(
        Test.machine,
        Test.ctx,
        flows,
        (steps, final, initCmds) => {
          const outputs = [
            Test.encoded(final),
            JSON.stringify(initCmds),
            ...steps.flatMap(({ next, cmds }) => [
              Test.encoded(next),
              JSON.stringify(Menu.view(next)),
              JSON.stringify(cmds),
            ]),
          ];

          const forms = [
            secret,
            JSON.stringify(secret).slice(1, -1),
            encodeURIComponent(secret),
            JSON.stringify(Array.from(raw)),
          ];

          return (
            outputs.every((output) => forms.every((form) => !output.includes(form))) ||
            "a link secret escaped its driver"
          );
        },
        { seed: Test.seed + draw, numRuns: 1 },
      );
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  { arbitrary: { seed: Test.seed, runs: 200 } },
);

// After build: read a clock in view, drop empty, duplicate keys, or rely on color for state.
it("L8: equal models give ordered unique items, empty is explicit, and state is in words", () => {
  propertyTrace(
    Test.machine,
    Test.ctx,
    Test.walks,
    (steps, final) => {
      for (const state of [Test.machine.init(null, Test.ctx)[0], ...steps.map((s) => s.next), final]) {
        const items = Menu.view(state);
        const clone = Schema.decodeSync(Test.modelJson)(Test.encoded(state));

        if (!Test.same(items, Menu.view(clone)) || !Test.same(items, Menu.view(state))) {
          return "equal models rendered differently";
        }

        const rank = { status: 0, empty: 1, waiting: 1, client: 2, action: 3 };

        const keys = items.map((i) =>
          Menu.Item.match(i, {
            status: ({ _tag }) => _tag,
            empty: ({ _tag }) => _tag,
            waiting: ({ key }) => key,
            client: ({ key }) => key,
            action: ({ id }) => `action:${id}`,
          }),
        );

        if (
          new Set(keys).size !== keys.length ||
          items.some((i, n) => n > 0 && rank[i._tag] < rank[items[n - 1]!._tag])
        ) {
          return "items are duplicated or out of their fixed category order";
        }

        if (
          items.filter(Menu.Item.isAnyOf(["empty"])).length !==
          (state.rows.length === 0 && state.clients.length === 0 ? 1 : 0)
        ) {
          return "empty was not explicit";
        }

        if (items.some((i) => i.words.trim().length === 0)) {
          return "an item has no words";
        }

        const status = items.find(Menu.Item.isAnyOf(["status"]));

        const statusWords = {
          connecting: /connect|starting/i,
          online: /running|online|connected/i,
          lost: /lost|disconnect|offline/i,
        };

        if (status === undefined || !statusWords[state.link._tag].test(status.words)) {
          return "the link state is not in words";
        }

        for (const item of items) {
          if (Menu.Item.isAnyOf(["waiting"])(item) && !/waiting/i.test(item.words)) {
            return "waiting is color only";
          }

          if (Menu.Item.isAnyOf(["client"])(item) && !/let in|own|this app/i.test(item.words)) {
            return "admission is color only";
          }

          const client = Menu.Item.isAnyOf(["client"])(item)
            ? state.clients.find((c) => c.key === item.key)
            : undefined;

          if (client?.tabs._tag === "unknown" && !/unknown/i.test(item.words)) {
            return "unknown tabs were shown as a count";
          }
        }
      }

      return true;
    },
    options(200),
  );
});

// After build: interpolate the raw label, omit the cap, or cut through a surrogate pair.
it("L9: prompts and items keep the code and the safe label within the pinned 256-unit limit", () => {
  const hostile = fc.record({
    label: fc.oneof(
      fc.constant(""),
      fc
        .tuple(Test.label, fc.constantFrom("\u0000\n\t\u001b", "\u202e\u2066\u2069", "\u007f\u0085"), Test.label)
        .map(([a, controls, b]) => `${a}${controls}${b}`),
      fc.stringMatching(/^[A-Za-z]{512,1024}$/),
      fc
        .tuple(fc.integer({ min: 253, max: 257 }), fc.constantFrom("😀", "𐐷"))
        .map(([length, pair]) => `${"x".repeat(length)}${pair}tail`),
    ),
  });

  const flows = hostile.chain(({ label }) =>
    Test.walks.map((messages) =>
      messages.map((msg) =>
        msg.type === "rows"
          ? { ...msg, rows: msg.rows.map((r) => ({ ...r, label })) }
          : msg.type === "clients"
            ? { ...msg, clients: msg.clients.map((c) => ({ ...c, label })) }
            : msg,
      ),
    ),
  );

  propertyInvariant(
    Test.machine,
    Test.ctx,
    flows,
    ({ prev, next, cmds }) => {
      for (const item of Menu.view(next)) {
        if (/[\p{Cc}\p{Cf}]/u.test(item.words)) {
          return "control or bidi characters reached item words";
        }

        const shown = Menu.Item.matchOrElse(
          item,
          {
            waiting: ({ key }) => next.rows.find((r) => r.key === key),
            client: ({ key }) => next.clients.find((c) => c.key === key),
          },
          () => undefined,
        );

        if (shown !== undefined && !hasLabel(item.words, shown.label)) {
          return "an item lost the shown label, exceeded its limit or split a surrogate pair";
        }

        if (Menu.Item.isAnyOf(["waiting"])(item)) {
          const row = next.rows.find((r) => r.key === item.key);

          if (row === undefined || item.code !== row.code || !hasCode(item.words, row.code)) {
            return "a waiting code was lost or replaced";
          }
        }
      }

      for (const command of cmds) {
        if (command.type === "check") {
          if (/[\p{Cc}\p{Cf}]/u.test(command.reason)) {
            return "raw control characters reached the check prompt";
          }

          const act = Match.valueTags(next, {
            checking: (n) => n.act,
            idle: () => Match.valueTags(prev, { checking: (p) => p.act, idle: () => undefined }),
          });

          if (
            act === undefined ||
            !hasLabel(command.reason, act.shown.label) ||
            Match.valueTags(act, {
              approve: ({ shown }) => !hasCode(command.reason, shown.code),
              remove: () => false,
            })
          ) {
            return "the check prompt lost the clicked label or code";
          }
        }
      }

      return true;
    },
    options(200),
  );
});

// The test Layer is a public sibling, so later driver laws can ask without platform handles.
it.effect.prop(
  "the test PersonCheck consumes only supplied answers and fails closed when exhausted",
  {
    answers: Schema.Array(Schema.Literals(["touch", "click", "declined", "unavailable"])).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20),
    ),
  },
  ({ answers }) =>
    Effect.gen(function* () {
      const check = yield* PersonCheck;

      for (const answer of answers) {
        const actual = yield* check.ask("generated test request").pipe(Effect.result);
        expect(actual._tag).toBe(answer === "unavailable" ? "Failure" : "Success");

        if (Result.isSuccess(actual)) {
          expect(actual.success).toEqual(
            answer === "declined" ? { _tag: "declined" } : { _tag: "checked", check: answer },
          );
        }
      }

      const exhausted = yield* check.ask("exhausted").pipe(Effect.result);
      expect(exhausted._tag).toBe("Failure");
    }).pipe(Effect.provide(PersonCheckTest.layer(answers))),
  { arbitrary: { seed: Test.seed, runs: 100 } },
);

describe("browser link start switch", () => {
  it.prop(
    "the action is offered only when its live half is enabled",
    { enabled: Schema.Boolean },
    ({ enabled }) => {
      const machine = Menu.machine({ linkTtl: Test.ttl, browserLink: enabled });
      const initial = machine.init(null, Test.ctx)[0];
      expect(Menu.view(initial).some((i) => Menu.Item.isAnyOf(["action"])(i) && i.id === "open_browser")).toBe(enabled);
      const msgs: ReadonlyArray<Test.Msg> = [{ type: "open_browser", cmd: Test.cmdId(3) }];
      const trace = foldEvents(machine, Test.ctx, null, msgs);
      expect(trace.steps.flatMap((s) => s.cmds).filter((c) => c.type === "open")).toHaveLength(enabled ? 1 : 0);
    },
    { arbitrary: { seed: Test.seed, runs: 200 } },
  );
});

// After build: replace the supplied lifetime with a constant inside the machine.
it.effect.prop(
  "L10: the lifetime loaded through ConfigProvider reaches the menu's live-pass boundary",
  {
    lifetime: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
  },
  ({ lifetime }) =>
    Effect.gen(function* () {
      const settings = yield* Declarations.all.parse(ConfigProvider.fromUnknown({ desktop: { "link-ttl": lifetime } }));
      const machine = Menu.machine({ linkTtl: settings.desktopLinkTtl, browserLink: true });

      const flows = arbGuidedSequence(
        machine,
        Test.ctx,
        {
          outside: {
            open_browser: fc.record({ type: fc.constant("open_browser"), cmd: Test.command }),
            rows: fc.record({
              type: fc.constant("rows"),
              at: fc.constantFrom(lifetime - 1, lifetime, lifetime + 1),
              rows: fc.array(
                Test.row.map((r) => ({ ...r, pass: "loaded-digest" })),
                { maxLength: 1 },
              ),
            }),
          },
          answers: {
            open: {
              draw: fc.constant("loaded-digest"),
              make: (pending, digest): Test.Msg => ({ type: "opened", cmd: pending.cmd, digest, at: 0 }),
            },
          },
        },
        { maxLength: 60, size: "max" },
      );

      propertyTrace(
        machine,
        Test.ctx,
        flows,
        (steps) => {
          let live = false;

          for (const { msg, next, cmds } of steps) {
            if (msg.type === "opened") {
              live = true;

              if (!next.passes.some((p) => p.digest === "loaded-digest" && p.until === lifetime)) {
                return "the machine replaced the loaded lifetime";
              }
            }

            if (msg.type === "rows") {
              const count: number = live && msg.at < lifetime && msg.rows.length > 0 ? 1 : 0;

              if (cmds.filter((c) => c.type === "sign_grant").length !== count) {
                return "the loaded lifetime did not decide whether a pass signs";
              }

              live = live && msg.at < lifetime && count === 0;
            }
          }

          return true;
        },
        { seed: Test.seed, numRuns: 1 },
      );
    }),
  { arbitrary: { seed: Test.seed, runs: 100 } },
);
