# Changing the product

Read this before a change to what a person sees or uses: a window, a screen, a mockup.

For a change to what a person sees or uses, in either version. These have no folder of their own:
a window lives in `apps/`, `programs/` and `next/` alike.

- **The daily moment comes first.** Cut scope by deferring, never by making the daily flow clunky.
  An outside tool that "works fine" is no reason to skip an in-app feature, and a design that needs
  Docker, a second server or a second app to start fails.
- **The first slice works, later slices harden.** Each tier is a whole vehicle
  ([tiers](../../../../docs/plan/tiers.md)). Each person answers for their own agents, so a first slice does
  not defend against them; strangers on a public address are a different case. Tier size never
  pushes work out: split the tier, and say what a new idea changes now. Make it work, then better,
  then secure ([0171](../../../../.decisions/0171-make-it-work-then-better-then-secure.md)).
- **Secure and simple.** For any security step, say when a person meets it and how often. No prompt
  on opening the app, nothing hourly. The protection goes in code, not in a chore.
- **No new paid accounts** until fabrika is a product. Design for the free route and say what it
  can't do. Cloudflare is the exception: fabrika assumes its paid Workers plan, such as its Secrets
  Store.
- **All in on Manti** ([0461](../../../../.decisions/0461-every-ui-part-is-on-manti.md)).
- **Keep the platform's defaults.** On a Mac, closing a window keeps the app running and Cmd-Q
  quits. Leaving a convention needs the owner's yes.
- **Subtle, and accessible without apology.** Color is never the only cue (WCAG 1.4.1). Give sources
  for ARIA and WCAG claims, and say what needs a real screen reader run. Read a design system's docs
  and components before you map its tokens.
- **No extra containers.** If something already draws an edge, a second line, box or background
  goes.
- **"Like Tuval" means read how Tuval solved the whole feature** before you design. Old code is
  evidence, not a target.
- **Mockups use the real thing:** real tickets, steps, programs and fact names, with a "made up"
  list for anything that isn't.
- **No rough first versions.** A change to the product (`apps`, `programs`, `packages`) lands
  finished and thought through: all it shows works, with no stub, dead button or "(not yet)". A
  piece that waits on other work stays out of the window until it is real. `experiments/` is the lab
  and may be rough.
- **Ask how Linear would do it.** Before building any screen (a program's window, the app's frame, a
  mockup), ask how Linear would build it as their new product. The PR says, per screen, what Linear
  would do, and where we differ and why. Tuval and tmux stay the defaults for tiling; where they
  clash with Linear's answer, name the clash for the owner to pick.
  - **Linear as the builder, never as the template.** The question is how Linear's team would build
    the feature as fabrika programs, with fabrika's own pieces: programs that compose in tiles, the
    desk, the top bar, pipes between programs. Their taste and quality bar, on our primitive. Never
    copy a Linear screen. Ask which program owns the job, what composes beside what, and what
    becomes a piece every program gets for free.
- **Pick the look before the PR.** A screen being built in `next/` runs the look step
  ([step 5 of the guidelines skill](../SKILL.md#5-build-3-or-4-designs-and-look-at-them-next-to-linear))
  before its pull request opens: 3 or 4 real designs, shots at the five layouts beside Linear, and
  the owner picks one. That covers all work in flight: the ask desk, the inbox, the project window
  and typography. The keys editor already does it.
- **Show it running.** A PR that adds or changes a program's window carries screenshots from the
  real built app, attached and never committed
  ([0160](../../../../.decisions/0160-pr-shots-are-never-committed.md)). The step that shoots writes them
  under `runs/`, and the lead attaches them, each with alt text. Take them the way
  `apps/fabrika/e2e.ts` drives the app: Playwright on Electron, with `FABRIKA_HOME` set to a test
  home of its own in a temp folder, never your real one. Look at each shot, and say in the PR what
  looks broken, empty or wrong.
- **Shoot more than one layout.** A window that looks right in one wide tile can break at half or a
  quarter. Mockups and PR shots show each key state in at least: one tile filling the window, two
  tiles side by side, two stacked, a 2x2 grid, and a small app window (about 1024x700). Name each
  shot by state and layout, and say what squeezes or breaks in each.
