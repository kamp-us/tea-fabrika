// A shared suite for plant.integration.test.ts: a law with a plant, declared inside an exported suite function,
// the way libfabrika's `*Test.ts` suites are. It runs only from runs-shared.fixture.ts, so plant.ts
// runs that file and its record must name this one, where the law is declared. Its name is no test
// file's and does not end in `Test.ts`, so no test run and no plant check reads it as a law file.
import { describe, expect, it } from "@kampus/vitest";

/** Declares the suite's one law; the runner file calls it. */
export const suite = () =>
  describe("a shared suite", () => {
    it("the shared law breaks", () => expect(2 + 2).toBe(5), { plant: "add one too many in the suite" });
  });
