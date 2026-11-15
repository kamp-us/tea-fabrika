// P39, next/: process discovery's laws, A5 and A13, on node:sqlite (0062).
import * as JobsTest from "../../jobs/JobsTest.ts";
import * as JobsLedgerTestSupport from "./JobsLedger.test-support.ts";

JobsTest.discoverySuite(JobsLedgerTestSupport.open);
