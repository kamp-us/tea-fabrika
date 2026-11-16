# 0096: stack layer 7 (the mock sweep fold) is ready, at `299c2819b`

The branch is `fabrikalfa/mock-fold-1`, head `299c2819bbaa29e2397c056b9b486c7ebb36057d`, built on
`eeb8ecdbb`. It is ready for its PR.

## What it holds, in order

| Step | What came in |
|---|---|
| `fabrikalfa/mock-plans` at `c28109626` | a clean merge |
| `fabrikalfa/mock-app-src-s1` at `d821377bb` | two test files conflicted, both sides kept |
| `fabrikalfa/mock-plans` at `eb7e56100` | a clean merge, plan docs only (`2cf3539d`) |
| a build row and a review row | `213642d9`, then `299c2819` |

## Checks at `299c2819b`

- **The Opus review passed.**
- **`loosening.sh`:** 0 hits on the plan merges. On the app-src s1 merge it found 9 hits, the same
  9 as on that slice alone, and each one swaps a spy for an equal or stricter check.
- **`plancheck --approved`** exits 0 on mock-app-src and mock-transport.
- **`pnpm lint`** passed 18/18, and `pnpm typecheck` passed.
- **leakgrep on its own commits** (`eeb8ecdbb..HEAD`, 27 commits) is clean.
- **leakgrep on the added lines that land** (`-U0`), which I reran myself in a full clone, is clean.
- **Root:** one, `6e9a51046`, the same as main's. That was checked in my full clone. The fold's
  own box reported a second root, `f7d973e4a`. That is its shallow-clone boundary, and it has the
  unshallow rule now.

## Still to fold into layer 7

Layer 6's head, when it lands, and each mock slice reviewed from here on. When either comes, I
will mail the new head.
