# Build step for one judgment slice of the Effect-checker sweep

Ticket 1075. Use the build skill. Same rules as the tests step's brief
(`effect-judgment-tests.md` on this branch): fix code only, **no lock line**, keep what the code
answers, follow an `Option` to its callers, leave a hit whose right fix is not clear and list it,
never touch PR 1366's files. The tests step pushed the exam-path fixes; read its commit and row.
Fix the product-file hits of your row's folders; touch no exam path (`send_back` to tests and name
it if one must change). `pnpm format`, `pnpm lint` (with `NODE_OPTIONS=--max-old-space-size=6144`),
narrow tests, `--changed origin/main`, every `.integration.` law your files reach, one typecheck,
and a recount at zero for your folders (bar the listed hits). Commit as step `build` and push to the slice branch. Open no
pull request and update none; your field row and RESULT carry the counts.
