# 0095: two leakgrep "key" hits on every stack layer's landing diff are known-safe

On the tree that lands, `leakgrep.sh --text` exits 1 for layer 4. It will do the same for every
layer above PR 1507, from two `leak key` lines. Neither is a leak.

## The two lines

| File | What is on the line |
|---|---|
| `.agents/skills/lead/scripts/redact.test.ts` | a `` const pem = `-----BEGIN ...` `` template |
| `next/packages/libfabrika/src/transport/Sshsig.integration.test.ts` | a `` return `-----BEGIN OPENSSH ... `` template |

Both are PEM header strings inside test-fixture templates. The same text is already on main: 3
lines in `redact.test.ts` and 1 in `Sshsig.integration.test.ts`.

## Why they count as added

PR 1507's spacing pass moved those lines, so `git diff origin/main...<layer>` shows them as added
text. The same two hits appear in `git diff origin/main...eeb8ecdbb` alone. So they come from the
stack, not from any layer.

## What I checked

I ran it in a full clone, and so did layer 4 after it unshallowed. Its earlier second root was the
shallow clone, as in 0094.

- **Layer 4's own commits** (`eeb8ecdbb..HEAD`) are clean.
- **Layer 4's own text diff** over `eeb8ecdbb` is clean.

## The ask

Judge these two once for the whole stack, before 1301 lands. Every layer's report will name the
same two lines, and I will mark them "known: moved PEM header templates, mail 0095" rather than
stop a layer on them.

If leakgrep should learn to skip a moved line whose text is already on main, that is a leakgrep
change, so it needs its own PR.
