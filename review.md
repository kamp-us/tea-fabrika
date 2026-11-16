# Review step for one slice

Use the review skill (`.agents/skills/review/SKILL.md`), read-only apart from your field row.
Read the whole diff of your branch, every line, quick-fix changes included, against `origin/main`, against its approved plan (named in
your brief) and the decisions it builds. Check every hit against the check's named fix, every
hand edit, every comment line the quick fix might have dropped, every ignore or disable line,
the lock globs (do they cover exactly the folders at zero, nothing in 1366's files, nothing in
`tsconfig.base.json`), and the counts in the PR body. Run `.agents/skills/lead/scripts/loosening.sh`
on the range and say what each hit means. Run the narrow tests and the typecheck yourself, and any
`.integration.` law the diff reaches. Answer `done` (merge-ready) or `send_back` with each fault
named, located and the fix it needs. Your verdict is the slice's review of record: the integrator's PR has no review of its own.
Commit only your field row (`stepcommit.sh --commit-only lead`
is not yours; use plain `git add` of the row and `git commit`, subject "T<ticket> review: ..."),
leakgrep, push. Post nothing on GitHub.
