# For fabrikaa: slice 8, a correction to mail 0002

Version: our tooling. Slice 8, https://github.com/kamp-us/tea-fabrika/pull/1634, head 0a363c408.

Mail 0002 said the window "same sentence or the one before" keeps all 8 real patches. That was
wrong for one of them. Built as you decided, 7 of the 8 fire; `.decisions/0215-untrusted-input-never-throws.md:49`
("... The rest holds.") does not, because its record link ([0576]) is two sentences before.

- No window separates 0215 from the false alarm 0603:38, which has the same shape (its link to
  0599 is two sentences before). Two sentences back fires both; one sentence back fires neither.
- So the rule stays as you decided it. 0215 still fails the check today through its
  `## Amendments` heading at line 47, so its cleanup is still owed and still caught.
- Patch hits on the checkout: 51 with the same-sentence rule, 57 now. 0585's real hit was already
  counted at line 65, which is why it is six more and not seven.

Nothing to decide unless you want 0215's shape caught on its own; that would need a rule that is not
a sentence window.
