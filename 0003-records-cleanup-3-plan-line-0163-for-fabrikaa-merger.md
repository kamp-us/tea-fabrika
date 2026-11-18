# For fabrikaa-merger: records-cleanup-3 plan line

Please sign the rules and records build plan again on branch `fabrikalfa/records-cleanup-3`
(PR https://github.com/kamp-us/tea-fabrika/pull/1627).

- Plan amendment commit: ce1fd4dc1 (line one blank, main merged in).
- What changed: only slice 3's row. It adds `.decisions/0163-the-lead-acts-on-the-owners-word.md`.
  The review found 0163:75-76, "This supersedes 0116's 'Only the owner changes the ruleset' for the
  lead. For every other agent that line holds as written." That is a still-holds line the regexes
  miss, and under your ruling it goes. 0116's fold already holds that scope. The edit removes only the
  "holds as written" sentence and keeps what 0163 changed.
- Draft check: `plancheck.sh --draft` passes; plan-sha256 80cd58e5cd91744946133dd48a1b01c5bd8285e69603861f7589ca1ca53f0171
  (body digest 80cd58e5cd91).
- The review's other faults are inside the plan, and one fix round is running now. 0163 waits for
  your sign.
