# Delivery's defaults follow GitHub, then Gerrit, and each is a setting

Wherever Delivery's answer is "it depends", the answer is a setting, as its glossary already says. Each setting's default is what GitHub's merge queue does. Where GitHub's documents are silent, the default is what Gerrit with Zuul's gate does. We invent no behavior where a known one exists. We chose this because people who run a repository on GitHub already expect its behavior, a default nobody else has is a surprise each time, and a setting costs little once the choosing is one pure value. The facts behind each default are in [the research file](https://github.com/kamp-us/tea-fabrika/blob/research/merge-queue-defaults/.kalfa/research/merge-queue-defaults.md), and the design ticket is https://github.com/kamp-us/tea-fabrika/issues/1760.

Two defaults differ from the known behavior on purpose:

- **The carry rule is `kept`, not GitHub's "always".** An approval covers a new changeset when its changes are the same, which is Gerrit's way. GitHub's default is that an approval always carries. With agents writing most changes, an old approval must not cover different changes.
- **A hold stops a candidate that is already building from landing.** The Rust project's bors, the only system with a written answer, lets a running build land when its tree is closed. A hold is called when main is in trouble, and landing more on top is what it exists to stop.

## Considered Options

- Our own best guess for each case: rejected, because it was wrong twice during the design, on which checks a queue reads and on how approvals carry.
- Gerrit first, GitHub second: rejected, because few of our readers know Gerrit.
- No settings, one fixed behavior: rejected, because the glossary already ruled it out.

## Consequences

About twenty settings to document and test. GitHub's choice is sometimes the looser one, and the carry rule is where we chose against it. GitHub's documents are silent on eight cases (a push to a queued pull request, where a removed one comes back in, who may jump or remove, an outside push to main, a queued pull request already merged, any pause, a draft, and blame inside a failed group). Those defaults rest on Zuul or bors, or are our own, until a trial on a real repository says more.
