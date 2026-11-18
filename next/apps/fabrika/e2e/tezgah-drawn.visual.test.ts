// Slice A of the two-flakes plan, next/ (tickets 1166 and L33, decision 0036): T1, the law on the
// tezgah helpers' own read. `drawn` and `foldDrawn` (`tezgah.test-support.ts`) read what the tab draws
// for the tezgah laws, which poll them in `settle`. A read that waits inside that poll blocks it: a
// region that left the page after the snapshot made Playwright's per-name `boundingBox` wait its full
// 30 s, and the focus and fold laws failed on CI at that line.
//
// T1 holds the helpers to what a poll needs: no read inside them waits. It runs real Chromium on a
// static `page.setContent` page (no `dev.ts`, no brain), with the browser and profile of
// `p14.test-support.ts`. Regions and strips leave that page at generated moments *during* a read: the
// law hands the helper a page that counts every read the helper finishes, and removes the element it
// was told to right after the read it was told to. A removal after a snapshot is then exactly the
// moment the flake needed, with no timing to hope for.
import { runsFor } from "@kampus/vitest";
import { Array as Arr, Effect, Formatter, Option, Predicate } from "effect";

import * as fc from "fast-check";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { browser, profile, suite } from "./p14.test-support.ts";
import { drawn, foldDrawn, regionName, stripName } from "./tezgah.test-support.ts";

const SEED = 119120;

/** How a red law ends: at its first failing run, with its seed and path, and no shrinking. A read
 *  that waits costs its whole bound again on every shrink step. */
const RED = { endOnFailure: true } as const;

/** How long one read may take, in ms. On a static page it takes a few milliseconds; Playwright's
 *  wait for a region that left is 30 s, so two seconds is room for a slow CI machine and a fifth
 *  of the wait the law forbids. */
const WITHIN = 2000;

/** The law's own limit in ms: at most 100 runs, each a page and a read that is bounded by `WITHIN`. */
const LIMIT = 120_000;

/** A page for `read`: `regions` named regions then `strips` strips in one main, drawn the way the
 *  window draws a tile and a folded tile (`aria-label` on a section and on a button), each with its
 *  own box. */
type Drawing = { readonly regions: number; readonly strips: number };

/** What one list of the read is held to: the parts the page held, in its order, and what the read gave. */
type Listed = {
  readonly label: string;
  readonly all: ReadonlyArray<string>;
  readonly back: ReadonlyArray<{
    readonly name: string;
    readonly box: { readonly width: number; readonly height: number } | null;
  }>;
};

const html = ({ regions, strips }: Drawing) => {
  const tile = (n: number) => ({ program: "fabrika/checklist", n });

  const sections = Arr.map(
    Arr.range(1, regions),
    (n) =>
      `<section aria-label="${regionName(tile(n))}" style="flex:1 1 0;min-width:40px;height:120px">t${n}</section>`,
  );

  const buttons = Arr.map(
    Arr.range(regions + 1, regions + strips),
    (n) => `<button aria-label="${stripName(tile(n))}" style="flex:0 0 22px;height:120px"></button>`,
  );

  return `<!doctype html><main style="display:flex;gap:4px;padding:4px;width:640px">${Arr.join(
    [...sections, ...buttons],
    "",
  )}</main><div aria-live="polite"></div><div role="status"></div>`;
};

const names = ({ regions, strips }: Drawing) => ({
  regions: Arr.map(Arr.range(1, regions), (n) => regionName({ program: "fabrika/checklist", n })),
  strips: Arr.map(Arr.range(regions + 1, regions + strips), (n) => stripName({ program: "fabrika/checklist", n })),
});

/** `target`, as every read the helper makes on it finishes: after the `n`th one, `then(n)` runs. A
 *  call on the page or on a locator it hands out that returns a Promise counts as one read; one that
 *  returns a locator is wrapped again. Nothing else about the page changes. */
const counting = <T extends object>(target: T, then: (n: number) => Promise<void>, seen: { n: number }): T =>
  new Proxy(target, {
    get: (t, key) => {
      const value = Predicate.hasProperty(t, key) ? t[key] : undefined;

      if (!Predicate.isFunction(value)) {
        return value;
      }

      return (...args: ReadonlyArray<unknown>) => {
        const out = value.apply(t, args);

        if (Predicate.isPromise(out)) {
          return out.then((read) => {
            seen.n += 1;

            return then(seen.n).then(() => read);
          });
        }

        return Predicate.isObject(out) ? counting(out, then, seen) : out;
      };
    },
  });

/** Removes the part named `name` from the page, if it is still there. */
const remove = (page: Page, name: string) =>
  page.evaluate((label) => {
    const el = [...document.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label") === label);
    el?.remove();

    return el !== undefined;
  }, name);

const drawing = fc.record({ regions: fc.integer({ min: 2, max: 6 }), strips: fc.integer({ min: 1, max: 4 }) });

const leaving = fc.record({
  part: fc.constantFrom("region" as const, "strip" as const),
  index: fc.nat({ max: 5 }),
  at: fc.integer({ min: 1, max: 6 }),
});

describe("T1: the tezgah helpers' reads never wait", () => {
  it(
    "T1: for a tab whose regions and strips leave at generated moments during a read, drawn and foldDrawn return within 2 s, name only parts the page held, and give each name it returns a box",
    { timeout: LIMIT },
    (context) =>
      suite(
        Effect.gen(function* () {
          const services = yield* Effect.context<never>();
          const b = yield* browser;
          const profiled = yield* profile(b);
          // The removals that happened during a read, by what was read and what left.
          const fired = new Map<string, number>();

          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(
                fc.record({
                  read: fc.constantFrom("drawn" as const, "foldDrawn" as const),
                  page: drawing,
                  leaves: fc.array(leaving, { minLength: 1, maxLength: 4 }),
                }),
                ({ read, page: shape, leaves }) =>
                  Effect.runPromiseWith(services)(
                    Effect.scoped(
                      Effect.gen(function* () {
                        const page = yield* Effect.acquireRelease(
                          Effect.promise(() => profiled.newPage()),
                          (p) => Effect.promise(() => p.close()),
                        );

                        yield* Effect.promise(() => page.setContent(html(shape)));
                        const held = names(shape);
                        const gone = new Set<string>();

                        const plan = Arr.map(leaves, (l) => {
                          const among = l.part === "region" ? held.regions : held.strips;

                          return { ...l, name: among[l.index % among.length] ?? "" };
                        });

                        const seen = { n: 0 };

                        const spied = counting(
                          page,
                          (n) =>
                            Promise.all(
                              Arr.map(
                                Arr.filter(plan, (l) => l.at === n),
                                (l) =>
                                  remove(page, l.name).then((went) => {
                                    if (went) {
                                      gone.add(l.name);
                                      fired.set(`${read} ${l.part}`, (fired.get(`${read} ${l.part}`) ?? 0) + 1);
                                    }
                                  }),
                              ),
                            ).then(() => undefined),
                          seen,
                        );

                        const timed = yield* (
                          read === "drawn" ? Effect.map(drawn(spied), (d) => ({ ...d, strips: [] })) : foldDrawn(spied)
                        ).pipe(Effect.timeoutOption(`${WITHIN} millis`));

                        expect(
                          Option.isSome(timed),
                          `${read} returned within ${WITHIN} ms (${seen.n} reads done)`,
                        ).toBe(true);

                        const got = Option.getOrThrow(timed);
                        const kept = (all: ReadonlyArray<string>) => Arr.filter(all, (n) => !gone.has(n));

                        const lists: ReadonlyArray<Listed> = [
                          { label: "regions", all: held.regions, back: got.regions },
                          { label: "strips", all: read === "foldDrawn" ? held.strips : [], back: got.strips },
                        ];

                        for (const { label, all, back } of lists) {
                          const said = Arr.map(back, (r) => r.name);
                          const at = Arr.map(said, (n) => all.indexOf(n));
                          expect(
                            Arr.every(at, (i, k) => i >= 0 && (k === 0 || i > (at[k - 1] ?? -1))),
                            `${label} named are parts the page held, in its order: ${Formatter.format(said)}`,
                          ).toBe(true);
                          expect(
                            Arr.every(kept(all), (n) => said.includes(n)),
                            `${label} that never left are all named: ${Formatter.format(said)}`,
                          ).toBe(true);
                          expect(
                            Arr.every(back, (r) => r.box !== null && r.box.width > 0 && r.box.height > 0),
                            `each of the ${label} named has its box: ${Formatter.format(back)}`,
                          ).toBe(true);
                        }

                        expect(got.mains, "the one main").toBe(1);
                        expect(got.main, "the main has its box").not.toBeNull();
                      }),
                    ),
                  ),
              ),
              { seed: SEED, numRuns: runsFor({ fast: 100, full: 100 }), ...RED },
            ),
          );

          // The law reached what it is about: parts that left in the middle of each read.
          for (const part of ["drawn region", "foldDrawn region", "foldDrawn strip"]) {
            expect(fired.get(part) ?? 0, `a ${part} left during a read in some run`).toBeGreaterThan(0);
          }
        }),
        context,
      ),
  );
});
