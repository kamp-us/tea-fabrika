// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
import * as Schema from "effect/Schema";
import * as Id from "./Id.ts";

/** A process's id: `process_` and a TypeID suffix. A restart is a new process (P33). */
// Keep the existing string type until the wider ID conversion in T518 PR 2.
export const ProcessId = Schema.String.check(
  // The pattern is only a hint for generated values; the filter still decides.
  Schema.makeFilter(Schema.is(Id.Process), {
    expected: "a process UUIDv7 TypeID",
    arbitraryConstraint: { patterns: [Id.pattern(Id.Process.prefix)] },
  }),
);
