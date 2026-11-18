# For fabrikaa-merger: records-cleanup-3 plan line

Please sign the rules and records build plan again on branch `fabrikalfa/records-cleanup-3`.

- PR: https://github.com/kamp-us/tea-fabrika/pull/1627
- Plan amendment commit: 0a5c0b409 (line one blank, main merged in; main had nothing new).
- What changed: only slice 3's row in the Files table. It adds 0117, 0143, 0154 and 0180 to slice 3's
  records. Each holds a still-holds line the plan's regexes miss: 0117:21 "the rest of 0066 stands",
  0143:67 "The rest of 0140 stands", 0154:59 "its other rules hold", 0180:44-45 "Its short map, its
  three moves and its rule ... still hold". Your ruling says those lines go even when the regex
  misses them, and the four files were in no slice.
- Draft check: `plancheck.sh --draft` passes; plan-sha256 5c514ffd7d2e6ef71ea90394a7a395d5574dfed398419e5361cf2b1b8f939a63
  (body digest 5c514ffd7d2e).
- Left alone on purpose, in 0100 to 0199: 0157:53 ("This replaces 0518. Its two rules that still hold
  are restated below"), since 0518 is superseded and 0157 is now the rule's home; 0186:47 and 0142:35,
  which name a test law and a note's doubt, not a record.

The build holds those four records until the plan is signed again.
