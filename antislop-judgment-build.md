# Build step for one anti-slop judgment slice

Ticket 1057. Use the build skill. Same rules as `antislop-judgment-tests.md` on this branch: fix
code only, no lock line, keep what the code answers, stop and list an unclear hit, never touch PR
1366's files. Fix the product-file hits; touch no exam path. `pnpm format`, `pnpm lint` on the
whole tree, narrow tests, `--changed origin/main`, reached `.integration.` laws, one typecheck.
Commit as `build`, push, update the PR body with the pr skill.
