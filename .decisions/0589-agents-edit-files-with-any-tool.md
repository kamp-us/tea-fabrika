---
id: 0589
title: Agents edit files with any tool, scripts and codemods included; review reads the diff, and laws and lint must pass
status: accepted
date: 2026-11-15
tags: [edits, scripts, codemods, sweep, review, agents-md]
---

# 0589: Agents edit files with any tool, scripts and codemods included; review reads the diff, and laws and lint must pass

```mermaid
flowchart LR
  edit["a change, made with any tool: an editor, a script, a codemod, a lint fix, a quick fix"] --> diff["the pull request's diff"]
  diff --> lists["the PR lists what changed"]
  diff --> checks["laws and lint pass"]
  diff --> review["review reads the whole diff"]
```

## Decision

The owner ruled on 2026-11-15 that the rule on how files are edited goes, as unnecessarily
strict. An agent may edit files with any tool: an editor, a script, a codemod, a lint autofix, or
the Effect language server's quick fix.

What still holds is everything else:

- review reads the whole diff;
- laws and lint must pass;
- the pull request lists what changed.

This supersedes [0588](0588-no-program-edits-files-but-the-language-servers-quick-fix.md) whole,
with its amendment. It also removes AGENTS.md's line "Change code with an editor-style edit, not
with a find-and-replace script run over the tree", in the same pull request.

## Consequences

- Nothing already redone by hand needs undoing. Effect slice E3's hand redo (PR 1435) stays as it
  is.
- A sweep slice may apply its fixes with a script or a codemod, such as ast-grep or jscodeshift. The
  PR names the tool and lists the changes, and the review reads the diff as it reads any other.
- "Move files with `git mv`, so history follows" stays. It is about history, not about how an edit
  is made.
