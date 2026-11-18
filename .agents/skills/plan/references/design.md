# Before you design anything

Read this before any plan, design, recommendation or question to the owner, and when you walk a pull request.

Each of these is read when a plan or a design is written. A decision file holds the rule where one
is linked; the others have no other home yet.

- **Lead with the known way.** Look up how the makers and the industry do it, and cite it, before
  you give a lean; a guess comes after, marked as a guess. If the plain way clashes with a stated
  goal, say so in one line, and let the owner pick. Never hide it behind a custom design.
- **Name the Elm answer first.** `@demlik/tea` is the Elm architecture in TypeScript. Parents are
  written by hand and step their children. Exceptions are named in
  [Elm first](../../../../docs/direction/elm-first.md) with their reason; the first is tsh lines. The same
  goes for coordination (registry, mailbox, links, monitors, supervisors): do what Erlang/OTP does
  unless a written reason says otherwise.
- **tea stays small.** A host composes tea and Effect; tea does not grow to fit a host, and it does
  not take on our conventions. tea code uses the Effect engine (`@demlik/tea/effect`), and the
  Promise engine stays for those who want it. `./otel` is experimental only because nobody had used
  it, so use it, and do not work around it. What these experiments decide wins over an older demlik
  issue or ruling. Real tea bugs stay their own tickets.
- **Never wait on upstream.** Patch a package we do not own with `pnpm patch`, file the upstream
  issue the same day, and keep building; the bump that takes the release deletes the patch
  ([patch upstream locally](../../../../docs/direction/patch-upstream-locally.md)). Read the package first and
  patch only a gap or bug that read proved
  ([0054](../../../../.decisions/0054-read-upstream-before-patching-it.md)). An upstream issue reports one bug
  we proved, with its repro; a list of missing features found by reading is patched locally and not
  reported in bulk.
- **Read the installed version.** Agents know older libraries. Before you write or judge code
  against one, read the lockfile's version and that version's docs. A lint rule that fires a lot
  means ask why before you call it a false alarm. Before you write Effect code, read
  `node_modules/effect/AGENTS.md` in full: it ships inside the installed package, so it always
  matches the lockfile. Where it and a decision here differ, the decision wins
  ([0023](../../../../.decisions/0023-next-follows-effects-code-style.md) and
  [the pattern](../../../../.patterns/effect-differences-say-why.md) list the differences). Read a
  package's source in the repo its installed `package.json` names in `repository`: for Effect that is
  `Effect-TS/effect`, never `effect-smol`, where v4 was only built as a beta.
- **Judge a design by its properties, never its size.** Never pick between designs by how many lines
  or agent hours each takes. Judge by what is lost, what holds, how it reads and how it fails. Size
  a design once it is picked.
- **Judge an idea against the plan, never against today's code.** A "not yet", "later" or "too small
  today" claim is checked against what the plan says we are building. A plan file that is behind a
  decision is fixed the same turn.
- **Solve a problem we have.** A big vision gets saved as a note and tied back to a real problem. An
  experiment picks the tech. Aim at two people working together first: packages for others and
  publishing are recorded as later.
- **Moving a job from an agent to code?** Say what the agent was absorbing that code will not (the
  case nobody listed), what the "I don't know" exit is, and whether the rule makes honesty
  expensive. Check a rule against real moves you made this session: would it have blocked them if a
  machine had started you?
- **Protocols first, and a browser is always a client.** Name the protocol a boundary speaks before
  its implementation. A protocol may not need what a browser lacks: no Node, no Unix socket, no
  files, no WebSocket-level frames. Ask of every design: could a browser tab be this client?
  ([a browser is always a client](../../../../docs/direction/a-browser-is-always-a-client.md)).
- **The data shape comes first.** Ask of every design: what fact is lost forever if we don't record
  it now? A fact that exists only when something is written (who, when on their own clock, what they
  saw, why) goes in now, even if nothing reads it yet: a field can be added later, but the entries
  written before it never get it. Derived things (durations, views, summaries) can wait, since they
  rebuild from the log. Before you say "add it later", say whether later loses data. If a fact is
  recorded but must not be trusted, keep it out of the deciding code's types.
- **Record wide, read later.** Record every measure we can, even if nothing reads it yet. The
  limits: it must not slow the work in a way we can measure, and it never holds a secret. Content a
  person may want gone stays deletable
  ([an agent run keeps its content](../../../../docs/direction/an-agent-run-keeps-its-content.md)). The
  industry's name is wide events (Honeycomb; Stripe's canonical log lines).
- **Names.** Use the industry's word for a thing
  ([use the industry's names](../../../../docs/direction/use-the-industrys-names.md)), checked on every pull
  request, prose included.
- **Data keys are short everyday words.** `for`, not `forWhat`. `reason`, not `reasonCode`. A key
  does not say again what its parent already says: inside an outcome, the reason is `reason`, not
  `outcomeReason`. If a short word could mean two things, pick a clearer short word before you reach
  for a long one. A short word keeps its one meaning inside its
  [bounded context](../../../../docs/direction/we-follow-ddd.md): `at` is a time, `by` is who wrote it, `_tag`
  is the case. Today's code keeps `why` and `kind` until that code goes.

  ```ts
  // Yes: read it out loud and it is a sentence.
  { _tag: "ask", to: "owner", for: "approval" }
  { _tag: "send", to: "builder", reason: "checks_red" }
  // No: longer, and the parent already said it.
  { _tag: "ask", askWho: "owner", forWhat: "owner_approval" }
  ```
- **Decided, and read in their files:** try an existing tool before you hand-write one
  ([0040](../../../../.decisions/0040-existing-tools-before-hand-written.md)); a choice that fits as a
  `fabrika.toml` value is one, and a plan asks "is this a setting?" of each new choice and says why not
  ([0069](../../../../.decisions/0069-choices-are-settings.md)); no question word is a name
  ([0081](../../../../.decisions/0081-no-question-word-names.md)); plural service names and test tooling read
  through its module ([0029](../../../../.decisions/0029-format-and-names-follow-effect.md)); new schemas are
  Effect Schema ([0209](../../../../.decisions/0209-schemas-are-effect-schema.md)); every union's tag is `_tag`,
  and plain fields stay plain words, such as `platform`
  ([0214](../../../../.decisions/0214-unions-are-tagged-with-tag.md)); a step answers in five verbs, which
  `outcomesOf` and `nameOf` in `packages/pipeline/src/stages/outcome.ts` write, in today's code that
  still says stage for a step ([0396](../../../../.decisions/0396-every-step-answers-in-five-verbs.md)); build
  from the six pipeline primitives in `packages/pipeline/src/primitives.ts` and their combos in
  `combos.ts` ([0421](../../../../.decisions/0421-reuse-before-special-rules.md)); talk to typed services,
  never straight to a command-line tool, `gh` included
  ([0231](../../../../.decisions/0231-ledger-and-codehost-are-separate.md)).

## Checks a plan picks

- **A check on the shape of code is a lint rule, never a test:** oxlint's own rule where one exists
  (`no-restricted-imports`), else ours in `oxlint-plugins/`. A plan asks "lint, type or test?" of
  every law.
- **A check that can block needs its false alarms measured first:** about 0% to block, up to 10% to
  only advise (Google, CACM 2018). Every number in a rule needs a source or our own data. A tool's
  default is not a source. [0523](../../../../.decisions/0523-advice-rules-block-where-clean.md) sets the
  five old advice rules aside from this: they block in every folder at zero.

## Check what is settled first

Before any question to the owner, design question, recommendation
or plan, search `.decisions/`, `.glossary/`, `docs/direction/`, `experiments/` and the plan for the
topic. Start with `node .agents/skills/lead/scripts/records.ts find "<words>"`, which ranks those
records (and `.patterns/`, `.runbooks/`) on `origin/main` by the rare words they share with yours,
then `rg` for what its shortlist cannot see: the plan, long note bodies, and other wordings. That holds for a question an agent's plan raises and for a pull request you walk: compare its
shape with the note it says it builds, and name any place it walks a decision back. A claim about
how a piece runs comes from reading that piece's note now, never from a summary. A settled note is
evidence, not a tiebreaker: nothing from before experiment 107 (the first run on a repo other than
demlik) is trusted without a test, and in a redesign every serious branch goes on the table, with
what it would undo. **A stated principle covers every case it fits:** apply an owner ruling's
principle to each case it decides, not only the one it came with. Only a case it truly cannot decide
becomes a question.

## Writing a design document

- **Show it in code.** A design or direction document carries code blocks: the types, the state, the
  step function, one example call with its answers. A reader should be able to see the machine from
  the code blocks alone. Mark a sketch as a sketch. Open with one small block that shows the whole
  idea.
