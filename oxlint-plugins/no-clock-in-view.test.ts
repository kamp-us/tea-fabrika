// The clock in a view (C1, owner 2026-11-05): React's `react/purity` refuses a clock or random read
// in render and allows one in a handler; our `no-clock-in-view` refuses both. These laws were the
// exam's (next/apps/fabrika/src/exam/clock.integration.test.ts) until 0591 moved them here. The
// planted view is `CLOCK_VIEW` in builtin-plants.ts, which plants.test.ts also runs for
// `react/purity`. Plant: drop `performance.now` and `crypto.randomUUID` from the rule's reads, and the
// handler lines 5 and 15 pass. (The rule has no handler visitor to drop: it refuses a read anywhere.)
import { describe, expect, it } from "vitest";
import { CLOCK_VIEW, CLOCK_VIEW_TEST } from "./builtin-plants.ts";
import { plant } from "./plant.ts";

const CLOCK = "fabrika(no-clock-in-view)";

const VIEW = "next/packages/tuval/src/window/view.tsx";

const CLEAN = "next/packages/tuval/src/window/clean.tsx";

const PLAIN = "next/packages/tuval/src/window/model.ts";

describe("the clock in a view", async () => {
  const all = await plant(CLOCK_VIEW.files);

  it("scenario: no-clock-in-view fires in render and in every handler, the passed-down one too", () => {
    expect(all(CLOCK, VIEW)).toEqual([2, 3, 5, 11, 15, 16]);
  });

  it("scenario: passes a time the view was given, a plain .ts file and tests", () => {
    expect(all(CLOCK, CLEAN)).toEqual([]);
    expect(all(CLOCK, PLAIN)).toEqual([]);
    expect(all(CLOCK, CLOCK_VIEW_TEST)).toEqual([]);
  });
});
