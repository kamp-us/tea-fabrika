// P42 slice 1 (ticket 770), next/: L7, its four exit orders and L6's checkpoint starts on node:sqlite (0062).
import * as StartChildTest from "../runtime/StartChildTest.ts";
import * as StartChildTestSupport from "./StartChild.test-support.ts";

StartChildTest.exitSuite(StartChildTestSupport.databases);
