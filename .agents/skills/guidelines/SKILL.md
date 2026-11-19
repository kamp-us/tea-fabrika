---
name: guidelines
description: Run a guidelines study, one product area's design from the settled check to an approved guideline page and its build plan. Use when an area needs guidelines, when a new or changed screen needs its look picked before its pull request opens, when an approved guideline page changes, or when an older note is sorted into the record kinds.
---

# A guidelines study

A study turns one design area into a few principles the owner can press, read and decide on, and
then into a build in the app. It ends with:

- one research file, from the research skill;
- 3 or 4 designs and a pressable prototype of the pick, from the prototype skill, on one
  throwaway branch;
- one guideline page, whose line one says **Proposed DATE.** and, on the owner's yes,
  **Approved DATE.**;
- one docs-only pull request, and a walk in chat that ends in a yes or a no;
- on a yes, the build plan the same day, as a quest.

`.kalfa/kalfa.toml` says where each record kind lives and what goes in it. A study writes a
`research`, a `guidelines` and a `quests` record, and its settled check reads the `decisions`,
`glossary` and `guidelines` records. Sorting an older note's pieces into the record kinds is its own
branch, with its own labels: read [sorting a note](references/sorting-a-note.md) whole first.

Read [the rules for changing the product](references/changing-the-product.md) whole before step 4.
Every design, prototype and page in the study follows them.

## The steps

### 1. Check what is settled

- Search the `decisions`, `glossary` and `guidelines` records in two or three wordings of the area,
  and read every hit. A guideline page is settled when its line one says Approved.
- Write down each decided point with its source. A decided point stays decided in every later step:
  follow it, and ask nobody about it again.
- Name the open pull requests on the same area (`gh pr list --search "<area>"`) and what each one
  already leans.
- **Name the scope in one line:** which program or part the study changes. The chassis (the top
  bar, the bottom line, each tile's title bar, the desk) stays as it is unless the study is about
  the chassis. A change the study seems to need outside its scope becomes a question for the owner.

**Done when** the scope line is written and you can list, with a link each, what is decided, what is
leaned, and what nobody has touched.

### 2. Read the makers

Use the research skill, with the question "how do the makers solve <area>?". Start it now: its
agent reads while you pick the running example (step 3). Brief that agent with this list, so the
file it saves holds all of it:

- 10 to 15 makers and tools: thinkers (papers, NN/g), tools people use all day, apps with a pointer
  (Apple's HIG, Linear, Figma), and WCAG.
- Two or three tools from outside software that solved the same shape of problem for people who
  work fast all day: a music tool (Ableton Live folds devices in place, and its Key Map mode marks
  every part that takes a key), a video editor, a game tool, a cockpit, a kitchen. Each says what it
  teaches and what does not carry over.
- Short quotes, checked against the page as fetched.
- The plain way they agree on comes first, before any lean of ours. Where it clashes with a goal of
  ours, one line says so.

**Done when**, before step 4, the research file is saved as a `research` record with every item
above, and you have read it whole.

### 3. Pick one running example

- One real case from today's code, read on main, with `file:line` for each claim: a mode the app
  has today, one real ticket's run, or the key code as it stands.
- The running example is carried through every later step: the principles, the designs, the
  prototype, the page and the walk. Every principle says whether the example follows it or breaks
  it, and where.

**Done when** the example is named in one line, with the `file:line`s you read on main today.

### 4. Test every principle three ways

Draft the principles from what the makers agree on and where the running example breaks it, as
many as the findings give. Write each one as a product principle in plain words: what a person
does and sees, never a test name, a type or a file. Rules that share one reason and one check are
one principle. Then give each principle these five:

- **Linear as the builder:** how Linear's team would build it as fabrika programs, in one line, or
  "No Linear answer: <why>". Where we differ, say why. Ask it of every rule, not only of screens.
- **The Elm or OTP answer:** Elm's model, update, view and parents stepping children, or OTP's
  mailbox, supervisor and `code_change`, where one fits. Say where we leave it.
- **Accessibility:** the WCAG criterion it touches, and what needs a real screen reader run.
- **A kind:** `law` (a test can check it), `lint` (`pnpm lint` can hold it) or `taste` (only a
  shot beside Linear checks it). The kind steers the build plan (step 12), and stays off the page.
- **A lean:** "Lean, NN%." with the doubt and what would settle it, or "No lean, the owner picks."

**Done when** every principle has all five.

### 5. Build 3 or 4 designs and look at them next to Linear

Steps 5 and 6 are also the **look step**. They run on their own for any new or changed screen
before its pull request opens, with or without a study; then read
[the rules for changing the product](references/changing-the-product.md) first.

Build the designs with the prototype skill's UI path: 3 or 4 variants of the program's window, each
a different answer to the same job, such as a list, a card, a panel or inline. Keys and mouse both
work in each. Read today's code for which jobs exist, and design how they look afresh. Our layer on
top of that skill:

- **The fabsh pipe line first.** Before a design is built, write its fabsh pipe line:
  `tracker --all | outline`, or `outline | ticket`. A part that is another program's job becomes
  its own tile, joined by a pipe: a sidebar that opens a detail, a list another program owns, a mode
  that swaps the whole view. One program does one job, and programs meet on typed pipes. Then ask
  Linear as the builder of the design: which program owns each part?
- **The real tokens and chassis.** Each design takes its tokens from the design package
  (`@kampus/fabrika-design`) and sits in the real chassis, with as few boxes as "No extra
  containers" asks.
- **Shots at five layouts.** Shoot each design as "Show it running" says, at the five layouts of
  "Shoot more than one layout", dark mode first, as the owner runs it. Set each shot beside today's
  app and beside the closest Linear screen, from Linear's public docs or changelog.

**Done when** each design has its pipe line, runs in the real chassis, and has shots at all five
layouts, each beside today's app and Linear.

### 6. The owner picks one, then refine it in rounds

- Show the owner the designs: each one's pipe line, its variant in the prototype skill's switcher,
  and its shots beside today's and Linear's. **The owner picks one.**
- Each design that lost gets one or two plain lines on why, tied to a principle or a shot ("lost on
  T2: the rec sits under the question, see the 2x2 shot").
- Refine the pick in rounds. For each shot, one line: would Linear's team ship this? Name what looks
  off: a box in a box, a gray that fights, a line nobody needs, loud text, a cramped layout. Fix it
  and reshoot. Two or three rounds is normal.

**Done when** you would ship the last round and the owner said yes to its look. On a no, go round
again.

### 7. Build the pressable prototype

Build the pick's prototype with the prototype skill's logic path. Its question: do the pick's keys,
clicks and states do what the principles say? Our layer on top:

- It uses the real tokens and draws the real chassis around the window, so it looks like the
  pick's shots. Its words, names and keys are the pick's own.
- Every key and click the principles name is an action: a free-play button, and its key while the
  window has focus. A press the app ignores is an action that says why.
- Each principle's **Try it** line ("press X, watch Y", from the state it starts in) is one guided
  walkthrough tab.

**Done when** every key and click the principles name has an action, every principle has its tab,
and you pressed each tab end to end.

### 8. Write the guideline page

Write `<area>.md` at the `guidelines` record's path, or for a visual area `<area>/README.md` with
its shots in `shots/`, in the shape of [the guideline page](references/guideline-page.md).

- **Line one is the status:** **Proposed DATE.** It becomes **Approved DATE.** on the owner's yes
  (step 11). That line is the record of the approval.
- One `## X1: <name>` per principle, with its fields. The kinds, the leans and their numbers, the
  `file:line`s, the lost designs and the smaller calls go in the pull request's body (step 10).

**Done when** every box in the guideline page's checklist is ticked.

### 9. Keep the prototypes

Capture them as the prototype skill says: every design, every round and the pressable prototype go
on one throwaway branch, pushed and kept out of main. Copy the shots the page links into its
`shots/`.

**Done when** the branch is pushed, and every shot the page links is in its folder.

### 10. Open a docs-only pull request

leakgrep.sh checks added text; private words stay outside the repo.

- Write its title and body with the pr skill. It holds the page and its shots.
- Beside the pr skill's parts, the body carries: the scope line; each principle with its kind, its
  lean or "No lean, the owner picks", and where the running example breaks it, at `file:line`; for
  a visual principle, its tokens and the layouts and Linear screen its look is judged at; the
  running example; what was decided; the designs and why each lost; the smaller calls, each with
  its options as small code blocks and a lean; what other open pull requests would change to match;
  the prototype branch; what it cannot tell us.
- It opens as a draft, and it lands after the owner's yes (step 11).

**Done when** the draft is open, and the pr skill's leakgrep check passed on its body.

### 11. Walk the owner through it

- One step per message, titled `**Step N of M: <name>**`, each naming what the owner looks at: a
  principle on the page, a design's shots, a tab of the prototype. Step one is the whole idea, then
  one step per principle, then the designs, then the smaller calls, then the prototype, then the
  merge.
- 3 to 5 short bullets per step, each with its lean and how sure, or "No lean, the owner picks".
  Then one everyday comparison. End with "Say next." and wait.
- A principle's step ends with its Try it line, so the owner presses it in the prototype's tab.
- At the prototype step the owner presses it. A press that does the wrong thing goes back to step 7
  before the walk goes on.
- The owner's answer on a lean changes the prototype first, then the page, then the pull request's
  body.
- The last step asks one yes or no: merge it? On a yes, before the merge and in the same pull
  request, line one of the page becomes **Approved DATE.**

**Done when** the owner answered the merge question, and on a yes the page says Approved.

### 12. Plan the build, the same day

An approved page is done when the app shows it, so every study ends here.

- The same day as the merge, write the build plan with the plan skill, for the version new work
  goes in. It is saved as a `quests` record, and it names the prototype branch.
- The plan picks which principles get codified, from each one's kind. A codified principle goes
  into the ticket's spec as user stories until it is built, then lives as a test whose name reads
  like the principle, so a reader finds it by the page's own words.
- Bring it to the owner as one yes or no: approve the plan? On a yes, file the build as a tracker
  ticket with `from` set to the page's pull request. The test writer starts as soon as a slot is
  free, then the build and one review, as for every pull request.
- The build folds the pick in properly, as the prototype skill says: rewritten, not promoted.

**Done when** the quest is saved and the owner answered it.

## Changing an approved page

A change to a guideline is an edit to its page, in a pull request the owner says yes to. The page
and its history are the whole record. A change to a codified principle changes its test, found by
its name, in the same pull request.

Keeping a page true is judgment, not a check: whoever changes an area reads its page, and when the
change makes a principle false, edits the page in the same pull request.
