// Laws O12 and O13 of .kalfa/quests/kalfa-quality-oxlint-PLAN.md, the plugin as a whole. O13: the plugin is named
// `@kalfa/quality` (the lead's answer in the plan) and holds exactly the eleven rules. O12: every message is neutral, so
// another repo reads nothing of ours in it; it names no path, ticket, owner or plan item of this repo, and a message that shows a
// disable line names the rule as `context.id` gives it, which is `rule-to-test/<rule>` under RuleTester and the plugin's
// own name in a config.
//
// Plants, each run once and undone:
// - O13: name the plugin `kalfa` in index.ts; name it `@kalfa`; drop `no-hand-tag` from `rules`; add a twelfth key;
// - O12: write `@kalfa/quality/no-cause-squash` into that rule's message by hand; put `(#2736)` back into
//   `no-throw-in-effect-gen`'s message; put "which the owner reads" back into `no-effect-run-outside-edge`'s.
import { it } from "@effect/vitest";
import * as fc from "fast-check";
import { expect } from "vitest";
import plugin from "./index.ts";
import { FIRING, messages, RULES } from "./Tester.test-support.ts";

/** What a message of ours must not hold: a name, a path or a number that only means something in this repo. */
const OURS = /fabrika|owner|FateWireCode|ticket|Tier|#\d+|\bP\d+\b|next\/|packages\/|apps\/|\.kalfa\/|oxlint-plugins\//;

/** The rule a disable line in a message names, for each such line. */
const DISABLED = /oxlint-disable-next-line (\S+)/g;

it("O13 pinned: the plugin is named @kalfa/quality and holds exactly the eleven rules", () => {
  expect(plugin.meta?.name).toBe("@kalfa/quality");
  expect(Object.keys(plugin.rules).toSorted()).toEqual([...RULES].toSorted());
});

it("O12 every message is neutral, and a disable line in one names the rule as context.id gives it", () => {
  fc.assert(
    fc.property(fc.constantFrom(...RULES), (name) => {
      const { code, reports } = FIRING[name];
      const written = messages(name, plugin.rules[name]!, code, reports);

      expect(written).toHaveLength(reports);

      for (const message of written) {
        expect(message).not.toMatch(OURS);

        for (const [, named] of message.matchAll(DISABLED)) {
          expect(named).toBe(`rule-to-test/${name}`);
        }
      }
    }),
    { seed: 119120, numRuns: 100 },
  );
});
