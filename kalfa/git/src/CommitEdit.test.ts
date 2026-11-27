// The laws of the commit edit helper on the in-memory adapter (S34 and S35), at 100 runs. The same laws run on the real git binary in
// ProcessRepository.integration.test.ts.
import * as CommitEditTest from "./CommitEdit.test-support.ts";
import { memorySubject } from "./MemorySeed.test-support.ts";

CommitEditTest.suite("memory", memorySubject, { runs: 100, timeout: 300_000 });
