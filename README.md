# Cloud twin tools

Never merged. A child session copies a file out of this branch into its own scratch folder.

- `checkerfix.mjs`: asks the Effect checker's language server for its own quick fix, one hit at a
  time, and applies the server's edits unchanged. `node checkerfix.mjs <check> <project dir> <file>...`
  The check must already be at error for those files in that project's tsconfig. It prints, per
  file, how many hits it fixed and which it left (no quick fix). The fix can drop a comment inside
  the block it rewrites: diff afterwards and put lost comment lines back. Each `CHANGE` line it
  prints goes in the PR's list of changes.
