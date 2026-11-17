# Ticket 1148 caps candidate

Today's tooling. Candidate unrun.

R5 in `scripts/caps.test.ts` owns a temporary Node compile cache. It removes the cache in
`finally`. The shared probe still starts a fresh process for every call. Its loader, config
initializers, environment checks, assertions and timeouts stay in place. Existing cache-disable
settings remain inherited. Child V8 coverage gets no compile cache.

The source keeps seed 119120, five property runs and both explicit examples. fast-check 4.10.2
yields explicit examples before generated cases within its five-run limit. A complete passing
R5 run therefore still starts 30 children, six per property run. This is a source count, not
an observed execution result.

No caps law ran on the laptop. The existing whole-file resource guard applies, and R5 was not
extracted into another file. No baseline, candidate timing, process count or cache cleanup was
measured locally.

After merging current main, normal formatting, the whole compiler check and full normal lint
passed. Scoped syntax parsing, the field-row check and diff whitespace check also passed.
No caps runtime check ran. The existing eligible Linux route must run the whole caps file
and all tests its normal selection reaches. No workflow, guard, CI flag or test selection is
changed here. Comparison with historical runs must report differences between runs and must
not call itself a controlled pair. A speedup remains unproved.
