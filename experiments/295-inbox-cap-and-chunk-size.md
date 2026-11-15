---
date: "2026-11-15"
scripts: "none on main; the script `experiments/295-inbox-cap.ts` is on the branch `fabrikalfa/295-inbox-cap`, raw samples in the owner's private archive"
summary: "`next/`, main at `ce15d9cb6`, node:sqlite on real files, five runs per cell, 78.5 s, $0. The plan's rules give `mail.chunk` = 1 MiB (the top of its range: no smaller size gets within 10%) and `mail.unread` = 16 (the 16 MiB budget binds; the read takes 20 ms at p95), with a cap maximum of 16,384. Lean, about 65%: 64 KiB and 256 instead, since a cap of 16 sends `full` to any chatty writer of small letters and a 64 KiB letter already costs 0.31 ms. The cap's lookups as the plan writes them read the whole newest letter (0.7 ms at 1 MiB), and a catch-up slows with the inbox's read history (a finding row). | $0"
---

# 295. What should the inbox cap and the chunk size default to?

Measured on 2026-11-15 for ticket 1041 (pipe plumbing), on main at `ce15d9cb6`. **Every claim is
about `next/`** (`next/packages/libfabrika/src/ledger` and `processes`), never today's version. The
script stays on the branch `fabrikalfa/295-inbox-cap`; only this write-up goes to main, and the raw
samples went to the owner's private archive
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)). No model was called,
no network was used, and nothing cost money.

**The answer.** Applied as the plan writes them, the rules give:

- **`mail.chunk` = 1 MiB.** No smaller size gets its write cost per KiB within 10% of the 1 MiB
  letter's. The nearest, 256 KiB, is 25% above it. So the rule picks the top of the setting's range.
- **`mail.unread` = 16.** At 1 MiB letters, 16 times the chunk is the 16 MiB budget, and a catch-up
  over 16 unread letters reads in 20.4 ms at p95, well under 100 ms.
- **The cap's maximum = 16,384**, the largest k measured.

**My lean, about 65%: `mail.chunk` = 64 KiB and `mail.unread` = 256.** The rules work, but they give
a cap of 16, and the cap counts letters of every size. A program that sends one small letter per
line, the case experiment 258 measured, would get `full` after 16 unread letters. A 64 KiB letter
already costs only 0.31 ms to write, so a 16 MiB value goes as 256 letters in about 80 ms against 16
letters in about 41 ms. A catch-up over 256 letters of 64 KiB takes 14.9 ms at p95. 64 KiB is also a
Linux pipe's buffer (experiment 258). What would settle it: how many unread letters a real chatty
pipe holds when its reader is slow, measured once the plumbing lands.

```ts
// The rules, applied to this run's numbers (median of five runs, inbox empty).
const writePerKiB = { 1: 0.147, 4: 0.0377, 16: 0.0114, 64: 0.00485, 256: 0.00316, 1024: 0.00252 }; // ms
// mail.chunk: smallest size with writePerKiB[size] <= 1.1 * writePerKiB[1024] (0.00277 ms)
//   -> only 1024 KiB qualifies.
// mail.unread: largest power of two k with readP95(k, chunk) <= 100 ms and k * chunk <= 16 MiB
//   -> at 1 MiB: k = 16, readP95 = 20.4 ms.
```

## What was run

One Node process under `nice -n 15`, with `TYPESAFE_API_KEY` unset. Node 26.13.0, SQLite 3.54.0 (the
one inside `node:sqlite`), `effect` 4.1.2 from the lockfile, on a 12-core laptop with 96 GB of
memory. The whole grid took 78.5 s; peak memory was 6.7 GB, from collecting 1 GiB catch-ups.

The script uses main's own code: `LedgerTransactionSql.layer` and `LedgerSql.layer` over `nodeSql`
on a real database file in a temp folder, WAL with `synchronous=OFF`, as experiment 258 and the node
tests do. The letter bodies are fixed sizes of filler text from a seeded generator (seed 295). The
script ran as committed on its branch; the formatter touched only its layout after the run.

- **Write**: one deliver-shaped turn in one `transact`. The cap's two lookups come first, as the plan
  writes them (`turn.read(stream, turn.head(stream) - 1)` on the inbox and on
  `processes/r:1/acked`), then the inbox append and the outbox append. The same turn without the
  lookups ran beside it, to show what the cap adds. Letter sizes 1, 4, 16, 64, 256 and 1,024 KiB,
  into an inbox already holding 0, 1,000 or 10,000 letters (and 100,000 at 1 and 4 KiB). 200 sends
  per run, five runs; each run's sends were deleted before the next. p50 and p95 are per run, then
  the median of the five. WAL bytes per letter were read with auto-checkpoint off.
- **Read**: a catch-up over k unread letters, `Stream.runCollect(mailbox.read(name, after))`, as the
  runner's `catchUp` does. k = 1, 4, 16, 64, 256, 1,024, 4,096 and 16,384, at the same six sizes. The
  inbox held exactly k letters, all unread. Five reads per cell; p95 of five is the slowest.
- **Ack**: the ack append alone, in the 1 KiB inbox of 10,000 letters.
- **History**: 256 unread letters of 1 KiB behind 0, 1,000, 10,000 or 100,000 letters already read.

## The numbers

| Letter | Write p50 (ms) | Per KiB (ms) | Cap lookups add (ms) | WAL per letter | Largest k under both budgets | Its read p95 (ms) |
|---|---|---|---|---|---|---|
| 1 KiB | 0.147 | 0.147 | 0.036 | 29 KB | 4,096 (16,384 takes 210 ms) | 42.8 |
| 4 KiB | 0.151 | 0.0377 | 0.035 | 37 KB | 4,096 | 53.2 |
| 16 KiB | 0.183 | 0.0114 | 0.038 | 49 KB | 1,024 | 21.3 |
| 64 KiB | 0.310 | 0.00485 | 0.058 | 99 KB | 256 | 14.9 |
| 256 KiB | 0.809 | 0.00316 | 0.164 | 297 KB | 64 | 24.3 |
| 1 MiB | 2.577 | 0.00252 | 0.714 | 1.09 MB | 16 | 20.4 |

Write times are with an empty inbox. The range of the five run p50s was narrow: 0.140 to 0.172 ms
at 1 KiB, 2.556 to 3.322 ms at 1 MiB. Other numbers the rules or the plan ask for:

- **Does the write grow with the inbox?** No. At 1 KiB the turn took 0.147, 0.155, 0.153 and 0.128 ms
  at 0, 1,000, 10,000 and 100,000 letters. The plan's check, 10,000 within 10% of 0, holds at 1 KiB
  (+4%) and fails at 4 KiB (+13%), but 64 KiB went the other way (-17%), and the lookups' own share
  stayed flat (0.036 to 0.045 ms at 1 KiB). I read the swings as noise in the append, not growth.
- **Read cost** is about 10 to 12 µs per letter plus about 0.8 ms per MiB. At small letters the
  100 ms budget binds first (1 KiB, k = 16,384: 210 ms); from 16 KiB up the 16 MiB budget binds.
- **The ack append alone**: 0.035 ms p50, 0.049 ms p95.
- **History**: the same 256 unread letters read in 2.5, 2.4, 3.3 and 13.4 ms behind 0, 1,000, 10,000
  and 100,000 read letters.

### Two things the plumbing pull request should know

- **The cap's lookups, as the plan writes them, decode the whole newest letter.**
  `turn.read(inbox, head - 1)` returns the full entry, body included, so the lookup costs 0.036 ms
  at 1 KiB but 0.714 ms at 1 MiB, 28% of that turn. A lookup that reads only the newest `pos` (one
  index read, like `head`) would keep the cap's cost flat at every size. The chunk rule's answer does
  not change without it: on the turn without lookups, 256 KiB is still 38% above 1 MiB per KiB.
- **A catch-up slows with every letter the inbox ever held.** Each page of a ledger `read` counts
  `sum(rev > ?)` over the whole stream for its span's `lag` tag (`ledger/internal/ledgerStore.ts`,
  `behind`). The cap bounds unread letters, not this. It is a finding row:
  `field/findings/2026-11-15-ledger-read-counts-the-whole-stream-per-page.json`.

## How the defaults follow

- **The chunk rule cannot pick below 1 MiB on this machine.** A turn costs about 0.145 ms whatever
  the letter's size, plus about 0.0024 ms per KiB (a straight line through the 1 KiB and 1 MiB
  points). Per KiB, that fixed part keeps shrinking all the way up, so cost per KiB never flattens
  inside 1 KiB to 1 MiB. Within 10% of 1 MiB's needs about 380 KiB or more. The rule is sound; the
  range ends before the curve does. So the rule says "as big as allowed". One cell sits on the line:
  256 KiB into an inbox of 1,000 letters took 0.00275 ms per KiB, just inside 10% of the empty
  inbox's 1 MiB figure. There is no 1 MiB cell at 1,000 letters to compare it with (cut by the 1 GiB
  bound), so I kept the empty-inbox comparison, where every size has a cell.
- **That makes the cap tiny.** The 16 MiB budget divided by a 1 MiB chunk is 16. The 100 ms budget
  never binds at 1 MiB (16 letters read in 20.4 ms).
- **The cap counts letters, not bytes.** The plan sizes the cap by `cap * chunk`, the worst case for
  a chunked send. A plain `send` letter is bounded by the ledger's row cap (2,000,000 bytes), not by
  `mail.chunk`, so `cap * chunk` is not a hard memory bound for plain sends either way.
- **The lean trades some write speed for a cap that fits chatty writers.** At 64 KiB, bytes go into
  the ledger at about 200 MiB/s against about 400 MiB/s at 1 MiB; at 256 KiB, about 320 MiB/s with a
  cap of 64. A 16 MiB value is 80 ms of writes at 64 KiB. I picked 64 KiB over 256 KiB because the
  cap of 256 leaves room for a writer of one small letter per line, and the write cost is already
  small. The doubt (35%): if pipes mostly carry big values, 256 KiB and 64 is the better pair.

## What it cannot tell us

- **A laptop's SQLite is not a Durable Object's.** The product's ledger runs in a Durable Object,
  with its own storage, its own sync and an output gate. This ran `node:sqlite` with
  `synchronous=OFF` on a laptop's SSD with a warm page cache. The shapes (fixed cost per turn, cost
  per letter on read) should carry over; the numbers may not.
- **The two budgets are the plan's, and the plan holds them at about 75%.** 100 ms is the classic
  limit for a reply that feels instant (Nielsen, 1993). 16 MiB is one eighth of a Worker's 128 MB
  memory, from the Cloudflare limits page the plan did not fetch. A different budget moves the cap
  in direct proportion.
- **The k grid is powers of four**, as the plan lists it, so the rule could only pick from those. At
  1 KiB, k = 8,192 might also fit under 100 ms; it was not measured.
- **Memory was not measured per read.** 6.7 GB peak is the process's, mostly from the 1 GiB reads;
  what one 16 MiB catch-up costs in a Worker's heap is not known.
- **No real runner ran.** These are the ledger's turns and `Mailbox.read`, not `send_chunks` through
  two runners, so the runner's own costs (the recovery save, the checkpoint) are not in them.
- **Five runs per cell.** p95 over five reads is the slowest of five. First reads in a cell were
  sometimes slow (1 KiB, k = 1: 1.7 ms against 0.17 ms p50).
- **Cut cells.** The plan's 1 GiB bound cut six: writes at 256 KiB into 10,000 letters (2.5 GiB) and
  at 1 MiB into 1,000 and 10,000 (1.2 and 10 GiB), and reads at 256 KiB with k = 16,384 and at
  1 MiB with k = 4,096 and 16,384 (4 to 16 GiB). None of them can change the defaults: every one is
  far past the 16 MiB budget.
