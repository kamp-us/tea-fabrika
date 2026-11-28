// The laws of fetch (F1 to F8) on the in-memory adapter, at 100 runs. The same laws run on the real git binary in
// ProcessRepository.integration.test.ts.
import * as FetchTest from "./Fetch.test-support.ts";
import { memoryFetchSubject } from "./MemorySeed.test-support.ts";

FetchTest.suite("memory", memoryFetchSubject, { runs: 100, timeout: 300_000 });
