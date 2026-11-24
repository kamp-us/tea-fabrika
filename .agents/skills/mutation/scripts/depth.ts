// depth.ts: how many cases a property law draws inside the mutation box (ticket 1306). Today's lead
// tooling, not product.
//
// A law names its own case count (`{ arbitrary: { runs: 100 } }`), and effect's `Arbitrary.configureGlobal`
// only fills a count a law left out, so no global setting lowers a count a law wrote. The box has to run
// each law three times over (the plain baseline, Stryker's dry run, then once per mutant a law covers),
// so on `@kalfa/git` a full-depth gate spent 285 s on the baseline and 251 s on the dry run before it
// tested one mutant. `MUTATE_RUNS` caps the count: a law that asks for more draws this many, and a law
// that asks for fewer keeps its own. The seed stays each law's own, so a capped run draws the first
// cases of the full run's sequence and nothing random is new.
//
// How it reaches the laws: `@effect/vitest` runs a property through `effect/Arbitrary`'s `checkEffect`.
// The config this file builds sends that import to `depth.arbitrary.ts`, which gives the same module
// back with `checkEffect` capped, and has vitest load `@effect/vitest` itself, since a package vitest
// does not load is imported by Node and never sees the swap. It caps what runs through `@effect/vitest`;
// a law that calls `Arbitrary.checkEffect` by hand through `effect` reaches the real one, and `fast-check`
// is not touched.
//
// The depth is in the container only: `mutbox.ts run --runs <n>` passes it as `MUTATE_RUNS`, and with no
// `--runs` nothing here is read (the hourly run on CI keeps full depth).
import { fileURLToPath } from "node:url"; // edge: the one path the real module is reached by

/** The count effect's `checkEffect` uses when neither a law nor the global defaults name one. */
export const LIBRARY_RUNS = 100;

/**
 * The cases a law draws under a cap: its own count when that is smaller, else the cap. A law that names
 * none draws the cap, so a missing count cannot run the library's 100. Pure.
 */
export const capped = (runs: number | undefined, cap: number): number => Math.min(runs ?? cap, cap);

/** One law's check options under a cap: the same options with the capped count. Pure. */
export const cap = <Options extends { readonly runs?: number | undefined }>(
  options: Options | undefined,
  to: number,
): Options & { readonly runs: number } => ({ ...options, runs: capped(options?.runs, to) });

/** The cap `MUTATE_RUNS` names, or `undefined` when it is unset. Anything but a whole number from 1 is an error. */
export const depthFrom = (value: string | undefined): number | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`MUTATE_RUNS must be a whole number, 1 or more, when set; got ${JSON.stringify(value)}`);
  }

  return Number(value);
};

/**
 * The part of a vitest config that caps property laws, `{}` when no depth is set: send `effect/Arbitrary`
 * to the capping module, keep the real one reachable under another name, and let vitest load
 * `@effect/vitest`. Merge it into `test`.
 */
export const depthConfig = (value: string | undefined) =>
  depthFrom(value) === undefined
    ? {}
    : {
        alias: [
          { find: /^effect\/Arbitrary$/, replacement: fileURLToPath(new URL("depth.arbitrary.ts", import.meta.url)) },
          { find: /^effect-real\/Arbitrary$/, replacement: fileURLToPath(import.meta.resolve("effect/Arbitrary")) },
        ],
        server: { deps: { inline: ["@effect/vitest"] } },
      };
