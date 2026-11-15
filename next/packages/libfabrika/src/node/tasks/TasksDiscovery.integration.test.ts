// P39, next/: process discovery's laws, A5 and A13, on node:sqlite (0062).
import * as TasksTest from "../../tasks/TasksTest.ts";
import * as TasksLedgerTestSupport from "./TasksLedger.test-support.ts";

TasksTest.discoverySuite(TasksLedgerTestSupport.open);
