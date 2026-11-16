# Effect sweep rows that waited on PR 1366 (from the sweep plan, ticket 1075)

| line | id | when | check | folders | hits | kind | model | steps |
|---|---|---|---|---|---|---|---|---|
400:| E60 | after 1366 | `unstableApiUsage` | the tags left in PR 1366's 16 files, and every folder not yet locked | 3964 | mechanical | Sonnet | tests, build, review |
401:| E61 | after 1366 | `preferNamespaceImport` | lib:runtime 403, lib:cloudflare 250, lib:processes 174, lib:settings 127, lib:ledger 115, lib:gateway 74, lib:telemetry 72 | 1215 | mechanical | Sonnet | tests, build, review |
402:| E62 | after 1366 | `newSchemaClass` | lib:runtime 181, lib:cloudflare 175, lib:gateway 62, lib:processes 34, app:src 30, lib:telemetry 23, lib:settings 17, lib:ledger 15 | 537 | mechanical | Sonnet | tests, build, review |
403:| E63 | after 1366 | `preferTypedSchemaDecoder` | lib:runtime 43, lib:settings 41, lib:cloudflare 33, lib:gateway 12, lib:processes 7 | 136 | mechanical | Sonnet | tests, build, review |
404:| E64 | after 1366 | `schemaClassMissingBrand` | lib:runtime 39, app:src 8, lib:processes 8, lib:ledger 5 | 60 | mechanical | Sonnet | tests, build, review |
405:| E65 | after 1366 | `schemaNumber` | lib:runtime 35, lib:gateway 12, lib:cloudflare 8 | 55 | mechanical | Sonnet | tests, build, review |
406:| E66 | after 1366 | `instanceOfSchema` | lib:cloudflare 15, lib:processes 11, lib:runtime 9, lib:ledger 1 | 36 | mechanical | Sonnet | tests, build, review |
407:| E67 | after 1366 | `unnecessaryTypeofType` | lib:runtime 21, lib:cloudflare 2, lib:gateway 2 | 25 | mechanical | Sonnet | tests, build, review |
408:| E68 | after 1366 | `schemaStructWithTag` | app:src 9 | 9 | mechanical | Sonnet | tests, review |
409:| E69 | after 1366 | `unnecessaryFailYieldableError` | lib:telemetry 3, lib:runtime 2 | 5 | mechanical | Sonnet | tests, build, review |
410:| E70 | after 1366 | `catchConditionalRefailToCatchIf` | lib:cloudflare 5 | 5 | mechanical | Sonnet | tests, build, review |
411:| E71 | after 1366 | `catchToIgnore` | lib:ledger 2 | 2 | mechanical | Sonnet | tests, build, review |
412:| E72 | after 1366 | `nestedEffectGenYield` | lib:processes 2 | 2 | mechanical | Sonnet | tests, build, review |
413:| E73 | after 1366 | `effectSucceedWithVoid` | lib:runtime 1 | 1 | mechanical | Sonnet | tests, build, review |
414:| E74 | after 1366 | `flatMapIgnoredParamToAndThen` | lib:runtime 1 | 1 | mechanical | Sonnet | tests, build, review |
415:| E75 | after 1366 | `preferEffectArray` | lib:runtime 821 | 821 | judgment | Opus | tests, build, review |
416:| E76 | after 1366 | `preferEffectArray` | lib:processes 366, lib:settings 298, lib:cloudflare 136 | 800 | judgment | Opus | tests, build, review |
417:| E77 | after 1366 | `preferEffectArray` | app:src 547, lib:telemetry 142, lib:gateway 94 | 783 | judgment | Opus | tests, build, review |
418:| E78 | after 1366 | `asyncFunction` | app:src 424, lib:runtime 209, lib:cloudflare 149 | 782 | judgment | Opus | tests, review |
419:| E79 | after 1366 | `preferEffectString` | app:src 209, lib:runtime 167, lib:settings 109, lib:telemetry 94, lib:cloudflare 65, lib:processes 54, lib:ledger 33, lib:gateway 25 | 756 | judgment | Opus | tests, build, review |
420:| E80 | after 1366 | `strictEffectProvide` | lib:runtime 358, app:src 210, lib:cloudflare 67, lib:gateway 35, lib:settings 33 | 703 | judgment | Opus | tests, build, review |
421:| E81 | after 1366 | `schemaSync`, `schemaSyncInEffect` | lib:runtime 168, app:src 126, lib:cloudflare 50, lib:processes 26, lib:gateway 25, lib:telemetry 17, lib:ledger 11 | 423 | judgment | Opus | tests, build, review |
422:| E82 | after 1366 | `anyUnknownInErrorContext` | lib:cloudflare 153, app:src 112, lib:runtime 100, lib:settings 10 | 375 | judgment | Opus | tests, build, review |
423:| E83 | after 1366 | `preferEffectRecord` | lib:runtime 97, lib:settings 92, app:src 69, lib:cloudflare 35, lib:processes 29, lib:telemetry 11, lib:gateway 3 | 336 | judgment | Opus | tests, build, review |
424:| E84 | after 1366 | `preferSchemaOverJson` | lib:runtime 58, lib:cloudflare 57, lib:gateway 25 | 140 | judgment | Opus | tests, build, review |
425:| E85 | after 1366 | `preferEffectArray` | lib:ledger 123 | 123 | judgment | Opus | tests, build, review |
426:| E86 | after 1366 | `processEnvInEffect`, `processEnv` | app:src 97 | 97 | judgment | Opus | tests, build, review |
427:| E87 | after 1366 | `missingPipeableSignature` | lib:runtime 23, lib:cloudflare 21, lib:processes 20, lib:settings 18, lib:ledger 6 | 88 | judgment | Opus | tests, build, review |
428:| E88 | after 1366 | `nodeBuiltinImport` | app:src 66, lib:cloudflare 12, lib:runtime 8 | 86 | judgment | Opus | tests, review |
429:| E89 | after 1366 | `globalDateInEffect`, `globalDate` | app:src 56, lib:gateway 2, lib:settings 2 | 60 | judgment | Opus | tests, build, review |
430:| E90 | after 1366 | `strictBooleanExpressions` | lib:runtime 29, app:src 26 | 55 | judgment | Opus | tests, review |
431:| E91 | after 1366 | `missedPipeableOpportunity` | lib:cloudflare 34 | 34 | judgment | Opus | tests, build, review |
432:| E92 | after 1366 | `newPromise` | app:src 32 | 32 | judgment | Opus | tests, review |
433:| E93 | after 1366 | `deterministicKeys` | lib:cloudflare 13, lib:runtime 6, lib:telemetry 2 | 21 | judgment | Opus | tests, build, review |
434:| E94 | after 1366 | `multipleEffectProvide` | app:src 21 | 21 | judgment | Opus | tests, build, review |
435:| E95 | after 1366 | `runEffectInsideEffect` | app:src 19 | 19 | judgment | Opus | tests, review |
436:| E96 | after 1366 | `globalFetchInEffect`, `globalFetch` | app:src 18 | 18 | judgment | Opus | tests, review |
437:| E97 | after 1366 | `globalTimers` | app:src 18 | 18 | judgment | Opus | tests, review |
438:| E98 | after 1366 | `globalErrorInEffectCatch`, `globalErrorInEffectFailure` | lib:runtime 9 | 9 | judgment | Opus | tests, review |
439:| E99 | after 1366 | `lazyEffect` | lib:cloudflare 6, lib:gateway 1, lib:runtime 1 | 8 | judgment | Opus | tests, build, review |
440:| E100 | after E60 | `apiStabilityLeak` | recount once every tag is gone (0574) | 242 | judgment | Opus | tests, build, review |
