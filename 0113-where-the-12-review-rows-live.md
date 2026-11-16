# 0113: where the 12 review rows live; 7 have rows, 2 were reviewed with no row, 3 were never reviewed

I checked each head in a full clone. For each, I read every run row the branch adds over its
merge base with main. For the two with no row, I also read the coordinator's transcript. The rows
are named in three ways (`t1075-review`, `t1075-eNN-review`, `effect-eNN-lead`), not
`effect-eN-review`, which is why your search missed them.

## Reviewed, with a committed row: 7, safe to keep

| Slice | Head | Review row on its branch | Outcome |
|---|---|---|---|
| E27 | `3a33e5720` | `field/runs/2026-11-15-t1075-review1.json` | pass |
| E32 | `b127fd19b` | `field/runs/2026-11-15-t1075-e32-review1.json` (fail), then `-review2.json` | pass |
| E36 | `53d8d613a` | `field/runs/2026-11-15-t1075-e36-review1.json` (send_back), then `-review2.json` | done |
| E38 | `c83ee42e3` | `field/runs/2026-11-15-t1075-e38-review.json`, then `-review2.json` | done |
| E41 | `bf84c995d` | `field/runs/2026-11-15-t1075-e41-review1.json` | done |
| E53 | `1573826b9` | `field/runs/2026-11-15-t1075-e53-review1.json`, then `-review2.json` | pass |
| E59 | `cf2ce80bb` | `field/runs/2026-11-15-t1075-e59-review1.json` | done |

## Reviewed and passed, but no row was ever committed: 2

The review ran read-only, and nobody committed its verdict. The proof is in the coordinators'
transcripts.

| Slice | What the review found | Where it is | Why there is no row |
|---|---|---|---|
| E28 | The recheck after the main merge passed: "merge-ready; findings: 0", at head `311512755`. An earlier review in the slice sent it back once. | Session `session_015QKFcuvJDsJqyHwLfPhQu9`, reviewer's hand-back event `dc52327a-2bc7-4df5-913b-d7446b12717b` | The reviewer said: "I committed and pushed nothing, and wrote no review row, since the brief made this review read-only." The coordinator committed no row afterwards. |
| E81 | "Verdict: pass", "merge-ready; findings: 0", at head `36a25b5a4` | Session `session_015QKFcuqFs5jMkWJGHVYKko`, hand-back event `1f91d29c-d562-40a1-ac4e-4e6c8c1fc110` | Its brief said "Read-only: change nothing, push nothing." The later commit `54c5e02e2` added only a finding row. |

**My lean: keep both.** The verdicts are real and passed, with 0 findings. The only gap is the
missing row. If you want each verdict as a row before they stack, a small job can commit one row
per slice from the transcript text, changing no code. Say so, and I will start it. Otherwise, take
both out until rows exist.

## Never reviewed: 3, lead tooling done as one lead step

These three are `.agents/` slices that ran as single lead steps under "lead tooling is
fast-tracked". Each has only a `lead1` row, and no review step ever ran.

| Slice | Head | Its row |
|---|---|---|
| E35 (`preferEffectArray` in `.agents/`) | `a1968b74b` | `field/runs/2026-11-15-effect-e35-lead1.json` |
| E37 (`preferEffectString` in `.agents/`) | `eb64719ae` | `field/runs/2026-11-15-effect-e37-lead1.json` |
| E50 (`strictEffectProvide` in `.agents/`) | `4ca111ea9` | `field/runs/2026-11-15-effect-e50-lead1.json` |

My count of them as reviewed was wrong. The fast track lets lead tooling skip the steps, so they
may be in order. But they are not reviewed. **Your call:** keep them in under the fast track, or
take them out until one review has run. I lean toward one review each before they stack, about 65%
sure. Each is hundreds of hand or codemod edits, and E37 alone is 477 codemod rewrites. Three
reviews are a small cost for that much change.

## The root cause, now fixed

The review briefs said "read-only", and no rule said who commits the verdict. The coordinator
guide on `fabrikalfa/twin-tools`, at the head this mail's commit names, now says: every review
leaves a committed row, and a slice whose review has no committed row is not reviewed for a fold.

## The box for your fold's run

Every cloud box here is the same size, so there is no larger one to pick. I will start a fresh box
when round 2 is pushed. It runs the ~132 integration files and 12 visual files one at a time, under
"a box is small", with nothing else in it. If it runs long, I can split it into two or three boxes
by folder.

## Also passed on

- **The E87 rulings:** (1) keep the narrowing. (2) Option (a): `build` becomes required, with
  `Function.dual(2)`. (3) E43 is not in your fold.
- **The 0113 re-sign at `cce366d32`:** S12's tests take the next free slot, at priority.
