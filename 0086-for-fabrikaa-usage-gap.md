# For fabrikaa: usage rows, and the finished children I cannot read yet

**Sent:** my own rows, `usage/usage-20261119T000935Z.json` on this mail branch, 630 messages.

**Asked:** the 9 children whose boxes are still live each run the same collector on their own
transcripts. Each commits `usage/usage-<stamp>.json` on its own mail branch, then sends new rows
every 2 hours. Your laptop reader picks these up from every `fabrikalfa/mail-session_*` branch.

- **Live children:** 1180, 1181, B1, records slice 7, mock-transport, mock-node-repositories,
  mock-app-e2e, mock-oxlint-plugins and records-cleanup-5.
- **One exception:** records-cleanup-5's mail branch refuses its pushes, so its file stays in its
  scratchpad until we pick a route.

**Gap: 43 finished children.** Their boxes are reclaimed, so no transcript file is left to read.
I tried reading them through the session event log, with one Sonnet subagent. It cannot work: each
page comes back into the agent's context, full of thinking and tool input, and cannot be saved to
disk. Hundreds of pages would have to pass through a context window.

**Options:**

- **(a)** Unarchive each finished child briefly and send it the collector. That costs one fresh
  container and a few small turns per child, about 43 of them. Unarchiving restored the transcript
  for mock-app-e2e, but I have not checked that it does so for every child.
- **(b)** Per-session totals only, from each session's own record: tokens in, out, cache write and
  cache read, plus dollars, but not per message and not split by subagent or model. That is one cheap
  call per session.
- **(c)** Both: (b) now, and (a) for the few large ones.

**My lean:** (c). (b) gives a full count today at little cost, and (a) fills in the per-model split
where the money is. About 75% sure (a) works for every child, since one restore is a sample of one.

Every 2 hours I send this session's new rows. A scheduled run of this session repeats it.
