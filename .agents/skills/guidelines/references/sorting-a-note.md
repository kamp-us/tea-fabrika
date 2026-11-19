# Sorting a note

An older note mixes rulings, principles, words, history and plans. Sorting it gives each piece one
home and one label, then the note is deleted. `.kalfa/kalfa.toml` says what goes in each record
kind; this file holds the labels, and the cases a record kind's prompt does not settle.

## The labels

Each piece gets one label, and each label names its home.

- **already held**, naming the holder: an ADR, a lint rule, a test, a glossary row or a page that
  already says the piece. The note's copy is deleted, and nothing is added to the holder. A detail
  the holder lacks is its own piece, sorted on its own; it is usually code.
- **ADR**, **glossary**, **guideline**, **research** or **pattern**: a new record of that kind, as
  its prompt in `.kalfa/kalfa.toml` says.
- **code**: a check, a test, a type or a config file. A setting is code: its value lives in its
  config file.
- **spec**: a tracker ticket, for work that is decided but not built, or an outcome someone can
  check.
- **notes**: the notes repo, for what teaches a lesson but holds no rule.
- **drop**: stale, and needed nowhere. A piece that is still true is already held, or it goes to a
  home.

The sort adds nothing to an existing ADR, with one exception: a row that compares us with an outside
model, such as OTP or Elm, goes into the ADR whose choice it explains, or else to notes.

## The cases

- **A ruling** goes where the `decisions` prompt says: its why sits beside what enforces it, an
  ADR only when the three tests pass, and a spec while it is not built.
- **A product principle** goes to its area's guideline page, in plain words. Its detail, such as a
  table of keys, lives only in the test that holds it. A test in today's app holds it while that
  app runs; when the new version builds the area, the page's principle becomes user stories in
  that build's spec, then its new test.
- **A page the owner settled before the guideline page's shape**, on mockups or in a walk, counts
  as Approved, dated the day he settled it. The guidelines skill's page shape says how line one
  reads.
- **A reading of outside sources** is research. **A fact about how the code is shaped now**, such
  as a service's name, is a pattern, or the code itself.
- **A rename or a word** in an older note is not a decided word. It goes on the sort's list for the
  glossary talk, and no glossary changes from the sort.
- **A history line**, such as "Changed X: it said Y" or a guess that turned out wrong, goes to
  notes when it teaches a lesson, else it is dropped.
- **A vision, an open question or a "weigh it again when" line** is a spec when its outcome can
  be checked, else notes.
- **A link to the note** from code, a lint message or another record goes with the note. Where the
  why matters there, one line beside the code says it.

**Done when** every piece of the note has one label and one home, every link to the note is gone,
and the note is deleted.
