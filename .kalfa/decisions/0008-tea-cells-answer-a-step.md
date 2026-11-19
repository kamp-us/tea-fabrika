# A hand-written tea cell answers a Step, not a tuple

A hand-written tea cell answers a pipeable `Step` (`Step.stay`, `Step.to(model)` piped with `Step.run(cmd)`), and `Machine.make` turns it into tea's `[model, cmds]` tuple once. The tuple hides which part is the model and which are Cmds; we chose our own shape through a local patch of tea over tea's documented tuple. Undoing it is a sweep of about 500 to 650 return sites, and programs written with `Program.make` have no cells.
