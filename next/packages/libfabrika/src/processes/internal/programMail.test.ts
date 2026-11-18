// P41 slice 1, next/: program mail's pure rules (ticket 744). The delivery ID is the dispatched
// command's child under the documented `/mail` suffix, and lands in no space the brain or a runner
// owns; a destination is permitted only by the host's closed grant for that source. The real-store
// halves of L3 and L8 are in ProgramMailTest.ts.
//
// The contract these laws pin, from the plan's Files table:
//   internal/programMail.ts: `mailId(command)` and `granted(grants, source, to)`.
//   ProgramMail.ts: `Grants`, `MailRefusal` (the closed refusal reasons) and `ProgramMailError`.
import { describe, expect, it } from "@effect/vitest";
import { Schema, Match } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { PIDS } from "../Process.test-support.ts";
import { brainOnly, inRunnerSpace, inSignalSpace } from "../Process.ts";
import type { MailFailure } from "../ProgramMail.ts";
import { type Grants, MailRefusal, ProgramMailError } from "../ProgramMail.ts";
import { full, granted, mailId, unread } from "./programMail.ts";

const SEED = 119120;

/** A dispatched command's ID as the runner mints it: its process, an inbox position and an index. */
const fcCommand = fc
  .tuple(fc.constantFrom(...PIDS), fc.nat({ max: 1_000_000 }), fc.nat({ max: 64 }))
  .map(([process, pos, index]) => `${process}/${pos}/${index}`);

/** Names a host could grant, the prototype's own keys among them, so a grant is never inherited. */
const fcName = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}:[0-9]{1,2}$/),
  fc.constantFrom("__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"),
);

const fcGrants: fc.Arbitrary<Grants> = fc
  .array(fc.tuple(fcName, fc.uniqueArray(fcName, { maxLength: 4 })), { maxLength: 5 })
  .map((pairs) => {
    const grants: Record<string, ReadonlyArray<string>> = Object.create(null);

    for (const [source, targets] of pairs) {
      grants[source] = targets;
    }

    return grants;
  });

describe("P41 slice 1: program mail rules", () => {
  it("L3: a delivery ID is its command's one `/mail` child, distinct per command and outside every reserved space", () => {
    fc.assert(
      fc.property(fcCommand, fcCommand, fcName, (command, other, to) => {
        const id = mailId(command);
        expect(id, "the documented suffix on the dispatched command").toBe(`${command}/mail`);
        expect(mailId(command), "derived once: the same command gives the same ID").toBe(id);
        expect(mailId(other) === id, "two commands never share a delivery ID").toBe(other === command);
        expect(id.endsWith("/answer"), "never the runner's own answer namespace").toBe(false);
        expect(inRunnerSpace(id), "never a runner's answer or alarm letter").toBe(false);
        expect(inSignalSpace(id), "never a monitor signal").toBe(false);
        expect(brainOnly({ stream: `${to}/inbox`, id, tag: "send" }), "an ordinary inbox letter").toBe(false);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("L8: a destination is permitted only when the host's closed grant for that source names it", () => {
    fc.assert(
      fc.property(fcGrants, fcName, fcName, (grants, source, to) => {
        const own = Object.hasOwn(grants, source) ? grants[source] : undefined;
        const expected = own !== undefined && own.includes(to);
        expect(granted(grants, source, to), `${source} -> ${to} in ${JSON.stringify(grants)}`).toBe(expected);
        expect(granted(grants, to, source), "a grant is one way").toBe(
          Object.hasOwn(grants, to) && (grants[to] ?? []).includes(source),
        );
      }),
      {
        seed: SEED,
        numRuns: 200,
        examples: [
          // pinned: a plain object's prototype keys are never a grant.
          [{ "a:1": ["b:1"] }, "__proto__", "b:1"],
          [{ "a:1": ["b:1"] }, "constructor", "b:1"],
        ],
      },
    );
  });

  it("L13: every typed refusal encodes as its own reason under the error's `_tag`", () => {
    fc.assert(
      // T1041: `full`, a reader behind and not a refusal, is a reason of its own beside `storage`,
      // and the one that carries the target's unread count.
      fc.property(
        fc.constantFrom(...MailRefusal.literals, "storage" as const, "full" as const),
        fc.nat({ max: 16_384 }),
        (reason, unread) => {
          const error = Match.value(reason).pipe(
            Match.when("full", () => ProgramMailError.full(unread)),
            Match.when("storage", () => ProgramMailError.storage()),
            Match.orElse((refused) => ProgramMailError.refused(refused)),
          );

          const encoded = Schema.encodeUnknownSync(ProgramMailError)(error);
          expect(encoded).toMatchObject({
            _tag: "ProgramMailError",
            reason: reason === "full" ? { _tag: reason, unread } : { _tag: reason },
          });
          // SAFETY: ProgramMailError is a tagged struct (ProgramMail.ts), so its encoded form is an object with `_tag` and `reason`.
          expect(Object.keys(encoded as object)).not.toContain("kind");
          expect(Schema.decodeUnknownSync(ProgramMailError)(encoded), "it decodes back to the same error").toEqual(
            error,
          );
        },
      ),
      { seed: SEED, numRuns: 50 },
    );
  });

  it("type: only a full failure carries an unread count, and it always does", () => {
    // T1041: a `full` with no count, or a `storage` or refusal with one, is not a value of the type,
    // so no reader of a full failure falls back to a guessed count.
    type Failure = typeof MailFailure.Type;
    // The error's reason is a MailFailure case, and the error keeps no count beside it.
    expectTypeOf<ProgramMailError["reason"]>().toEqualTypeOf<Failure>();
    expectTypeOf<ProgramMailError>().not.toHaveProperty("unread");
    // A full failure's count is a number, never left out.
    expectTypeOf<Extract<Failure, { _tag: "full" }>["unread"]>().toEqualTypeOf<number>();
    expectTypeOf<{ readonly _tag: "full" }>().not.toExtend<Failure>();
    // No other case has a count, and the other cases are the refusals and storage.
    expectTypeOf<Exclude<Failure, { _tag: "full" }>>().not.toHaveProperty("unread");
    expectTypeOf<Exclude<Failure["_tag"], "full" | "storage">>().toEqualTypeOf<typeof MailRefusal.Type>();
  });

  // Ticket 1041 (pipe plumbing), written before the build: `unread(head, acked)` and
  // `full(head, acked, cap)` in internal/programMail.ts, the cap rule the commit turn applies.
  it("T1041 L3: an inbox is full exactly when its unread letters are at least the cap, and unread is never negative", () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(
        fc.record({
          head: fc.nat({ max: 100_000 }),
          acked: fc.nat({ max: 100_000 }),
          cap: fc.integer({ min: 1, max: 64 }),
          near: fc.integer({ min: -2, max: 2 }),
          edge: fc.boolean(),
        }),
        ({ head, acked, cap, near, edge }) => {
          // Half the cases sit at the cap's edge, head = acked + cap + near, where `>=` and `>` differ.
          const top = edge ? Math.max(0, acked + cap + near) : head;
          const count = top - acked;
          expect(unread(top, acked), `unread of head ${top} past ack ${acked}`).toBe(Math.max(0, count));
          expect(full(top, acked, cap), `full at ${count} unread, cap ${cap}`).toBe(count >= cap);
          reached.add(count < 0 ? "ack_ahead" : count === cap ? "at_cap" : count === cap - 1 ? "below_cap" : "other");
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    // An empty walk cannot pass: the ack ahead of the head, and both sides of the cap, were reached.
    expect([...reached].sort()).toEqual(expect.arrayContaining(["ack_ahead", "at_cap", "below_cap"]));
  });

  it("L13 format: other clients decode the refusal reasons by name, so the closed list is pinned exactly", () => {
    // P34c slice 4 adds `quota`: a sender whose program used up its room (0147, the plan's Q14).
    expect([...MailRefusal.literals].sort()).toEqual(
      ["bad_message", "forbidden", "id_reused", "no_name", "quota", "stale_sender"].sort(),
    );
  });
});
