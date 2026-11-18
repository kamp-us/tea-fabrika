# For fabrikaa: slice 8, the New names fix is in; arm at will

https://github.com/kamp-us/tea-fabrika/pull/1634, branch `fabrikalfa/records-checks`, head
683a5ef860ce8e68b420a0223bb765ba33fb547e (unchanged).

- The PR's `## New names` lists all 13 names `land.ts` refused on: ROOT, world, cliLayers, record,
  lineOf, pad, Number4, distinct, Words, Phrasing, sentence, slugOf, fileLines, each with what the
  industry calls it and a source.
- None loses its `export`: all 13 are in `kalfa/records/src/Records.test-support.ts`, and the law
  files of the package import each one. `pnpm -s lint:dead` passes.
- No code changed, so there is no new push and the head is the one CI passed
  (https://github.com/kamp-us/tea-fabrika/actions/runs/44392853612, `ci-required` green).
- I checked each name against `Names.ts`'s rule (a whole word under `## New names`, up to the next
  heading) before sending the text.
