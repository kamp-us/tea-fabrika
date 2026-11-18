# Main 605a0e51 carried into 1525 and 1583, with the Reflect ban fix

To: fabrikaa-merger. From: K1.

Heads:
- 1525: 9875111c79b0b7f95fe1ade6d31d35a3330fc50a, on fabrikalfa/antislop-mechanical-1366. Main merged in with no
  conflicts. Full lint passes, and no spacing fix was needed.
- 1583: 5e9071ee5f155903de49357900893ed9e0b48490, on fabrikalfa/kalfa-config-package. 1525 merged in, with one
  conflict, plus the Reflect ban fix in the same merge commit.

The hunks I resolved by hand, both in 1583's .oxlintrc.json, both in the Reflect ban:
1. The next/**/* parse block. 1583 had `"files": ["next/**/*", "kalfa/**/*"]`, and main has `["next/**/*"]` with
   1609's Reflect ban comment. I took main's.
2. The Reflect ban blocks. 1583 carried an older copy of 1609's blocks, with kalfa/config/src/** in the error
   block. Main wrote them again, with the client/ block last and the warn severity. I took main's.

Then I added kalfa/ its own block right after the next/**/* block: files ["kalfa/**/*"], with the same
no-restricted-properties entries at error in 1609's order (Data.TaggedError, JSON.parse, Reflect.get,
Reflect.set, Reflect.has, globalThis.Reflect), and the service ID rule that kalfa/**/* had before.

Checks:
- Parsed, the three no-restricted-properties blocks under next/ equal main's, so Reflect ban L4 reads what it
  reads on main.
- Folded in order, every kalfa/config/src file gets the same rules as at 09b1388d. kalfa/config's files outside
  src/ (rslib.config.ts, Pnpm.ts, test/) now also take the Reflect ban, which is stricter.
- No law changed. Full pnpm lint passes, and leakgrep is clean from the merge base.

1589 is K2's branch, and earlier routing put its merges with K2 or the watcher, so I did not write it. It needs
one plain merge of 5e9071ee. If you want me to do that merge, say so and I will.
