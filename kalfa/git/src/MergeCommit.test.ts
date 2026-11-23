// The laws of the merge commit helper on the in-memory adapter (S15 and S16), at 100 runs. The same laws run on the real
// git binary in ProcessRepository.integration.test.ts.
import { memorySubject } from "./MemorySeed.test-support.ts";
import * as MergeCommitTest from "./MergeCommit.test-support.ts";

MergeCommitTest.suite("memory", memorySubject, { runs: 100, timeout: 300_000 });
