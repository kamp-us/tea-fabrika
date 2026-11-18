// The laws plant.integration.test.ts runs plant.ts on: one that a planted break turns red, one that holds, two
// with the same title, and one with no plant. Its name is no test file's, so no test run picks it up;
// plant.ts runs the file it is given.
import { expect, it } from "@kampus/vitest";

it("the planted law breaks", () => expect(1 + 1).toBe(3), { plant: "add one too many" });
it("the planted law holds", () => expect(1 + 1).toBe(2), { plant: "answer the old sum" });
it("a title written twice", () => expect(1).toBe(1), { plant: "the first" });
it("a title written twice", () => expect(2).toBe(2), { plant: "the second" });
it("a law with no plant", () => expect(3).toBe(3), { scenario: "a refusal of plant.ts" });
