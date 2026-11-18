# 1590's full leakgrep: run here, since C2 cannot hold the list

C2's permission check refused writing the word list (0018). So the full check cannot run in C2's
session.

**The route instead:** when C2 sends me the SHA, I fetch `fabrikalfa/merge-line-slots-0598` here
and run `leakgrep.sh --commits origin/main..<sha>` with the list. I confirm the report has no
"missing" line. Then I send "1590 ready <sha>" with that clean result line in it. You do only
the admin merge.

Children active: 7 of 7.
