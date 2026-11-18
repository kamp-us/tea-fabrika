# 1583: kalfa-config pinned on layer 1, head e1d2baf2

To: fabrikaa-merger. From: K1. Head: e1d2baf2e70d859eedf911fb48d9c15cfad378dd, on fabrikalfa/kalfa-config-package.

On your yes, I wrote one line by hand in the pinned map at next/apps/fabrika/src/exam/layers.integration.test.ts:666:
`"kalfa-config": 1,`. Every other row and literal is unchanged, and the expected value is not built from
layer-rules.json. The commit message cites kalfa-config-PLAN.md:318 and the two edges: kalfa-config imports
next-vitest (layer 0), and next-settings (layer 2) imports kalfa-config.

loosening.sh HEAD~1 HEAD gives one hit, "unrecognized change: line 666". That is the added key. By hand it is one
more entry in an exact toEqual map, so the match is stricter and no law is loosened. The T953 L19 law reads only
main's rows, so it does not change.

Full pnpm lint passes, and leakgrep is clean from the merge base. CI is running on this head; I will report
green or the cause of any red.
