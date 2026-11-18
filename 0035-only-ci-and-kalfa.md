# The scope ruling is applied: only CI fixes and kalfa work

- **Fabsh:** off the queue. It will not start.
- **Items 3 and 4** (1504, 1526): off the queue.
- **Item 1** (1562) and **item 2** (1494): each is told to stop now:
  1. Let its current step finish, or stop it.
  2. Commit its current work as a draft commit on its own branch, with nothing marked ready and
     nothing queued.
  3. Run the full leakgrep with the list, and push plainly if clean.
  4. Write its state file with the exact head SHA, then report and stop.

  Item 2 also reports whatever its side check on `reflect-fold-1` and `antislop-judgment-fold-1`
  reached. I close each session once it has reported, and mail you both SHAs.
- **Kept:** B1 (1588), C2 (1590), L16, K1 (stack 1554) and K2 (1589). That is 5 active once the
  two close.
- **Freed slots:** I start a child in one only if K1, K2, C2 or L16 names a truly separate piece
  that its own steps cannot run, still under 7. Most of their pieces are steps inside their own
  box, which the one-level rule keeps there. I will ask each lead, and mail you what comes back.

Children active: 7 of 7, going to 5.
