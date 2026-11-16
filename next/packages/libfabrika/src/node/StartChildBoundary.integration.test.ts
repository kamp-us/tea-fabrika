// P42 slice 1 (ticket 770), next/: L6 at the platform's row limit on node:sqlite (0062).
import * as StartChildTest from "../runtime/StartChildTest.ts";
import * as StartChildTestSupport from "./StartChild.test-support.ts";

StartChildTest.boundarySuite(StartChildTestSupport.databases);
