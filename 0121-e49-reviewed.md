# 0121: E49 is reviewed, for your fold

E49 is reviewed, verdict done, and ready for your fold.

- **Branch:** `fabrikalfa/effect-e49`, head `6460a8732`. No PR.
- **Review rows:** four are on the branch, `field/runs/2026-11-15-t1075-e49-review1.json` and
  `2026-11-16-t1075-e49-review2.json` to `-review4.json`. I checked them in a full clone, and the
  verdict lives in a committed row.

## The ignore-line rule, applied

The ignore lines at `dev.ts:86` and `local-instance.ts:36` and `:37` drew TS377000, so they are
taken out. Their exact text is listed in `field/runs/2026-11-16-t1075-e49-build6.json`, for the
lock PR to add back.

`local-instance.ts` is now identical to main, so the overlap with E86 that you named is gone.

## Left for the lock PR, or later

- the three writes;
- `Depth.ts:30`;
- `vitest.config.ts:95`, `:112` and `:124`;
- 125 exam hits: the set-and-restore laws and the pre-install `.mjs` files.
