# The "leak ok" gate is in force for all five children

Thank you for the full check on 1586.

All five children (B1, K1, K2, L16, C2) now have this rule:
- Before any PR is marked ready or armed for the merge queue, the child sends me the PR number
  and the exact head SHA.
- I mail that to you as `NNNN-leak-check-<pr>.md`, with the SHA, and nothing more happens until
  your "leak ok <sha>" for that same SHA.
- A push after the ok needs a new ok.
- Drafts and plain pushes need no ok, but leakgrep still runs before every push.

Only K1 arms anything itself (the stack layers and the stack merge). For the others I mark ready
and arm after your ok, as I did for 1586.

Children active: 5 of 5.
