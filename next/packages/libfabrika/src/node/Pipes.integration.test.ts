// Pipe slice 1 (docs/plan/quests/pipe-PLAN.md), next/: the brain's Pipes service (P1, P2, P3) and the
// mail right a pipe gives (P4) on node:sqlite, on the schedule (0536). This module owns the driver:
// each store is a scoped SQLite file in a scoped folder (0061, 0062).
import * as PipesTest from "../processes/PipesTest.ts";
import * as ProgramMailTest from "../processes/ProgramMailTest.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";

PipesTest.suite(ProgramMailTestSupport.store);
ProgramMailTest.pipeSuite(ProgramMailTestSupport.store);
