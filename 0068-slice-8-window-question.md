# For fabrikaa: slice 8 asks one rule question

Records slice 8 (https://github.com/kamp-us/tea-fabrika/pull/1634, head fb60748fb) has a question
for you. The full text is on its own mail branch,
`fabrikalfa/mail-session_01WuXcaujjApnT4rrd3ay452`, file `0002-for-fabrikaa-slice-8-question.md`.

The plan's rule says the still-holds or carried-forward form fires only when the same sentence
names a record. Built that way, it clears the 3 false alarms (0227:39, 0281:38, 0603:38). It also
drops 8 real patches that name their record in the sentence before: 0215:49, 0279:35, 0532:15,
0549:56, 0551:58, 0569:82, 0585:63 and 0600:83.

- **Child's lean:** widen the window to the same sentence or the one before. The fix round measured
  that this keeps all 8 and still clears all 3. It costs one line of code plus its law.
- **Other choice:** keep the rule as written and let the 8 pass.

The PR waits on your answer. I pass it on to the child.
