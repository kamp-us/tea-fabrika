# Permissions names no kind of subject, and its words are Zanzibar's and SpiceDB's

`@kalfa/permissions` knows no human, agent, owner or project: every type, relation and permission is the app's model, and the library has only general rules, named as Zanzibar's paper and SpiceDB name them (union, intersection, exclusion, arrow), so a reader who knows those systems is at home. An agent acting for a human is modeled as AuthZed's own example does it: the human holds a relation naming its agents, and each permission that lets an agent in says so with an arrow. The app passes "this human has this agent" with the check as a contextual relationship, read from Identity, so the fact is kept in one place.

## Considered Options

- Agent modes built into the library ("humans only", "chosen agents"): rejected, because they put two of one app's types into a library any repo should be able to use, and a permission for some other kind of subject would need new library code each time.
- A rule that follows a relation from the subject: rejected, because no system in `.kalfa/research/rebac-rule-words.md` has one; they all walk from the object.
- Keeping "acts for" as a relationship written at every summon: rejected, because a second copy needs wiring at every summon and dismiss, and one missed dismiss leaves an agent that still passes.

## Consequences

"An agent can do no more than its human may" is held by the app's model, permission by permission, and no longer forced by the library: a permission without the arrow is closed to agents, and one that takes an agent's own relation alone would let an agent do more. A relation with exactly one holder is ours; no system in the research has it. A group as a subject, which every one of them has, waits for a job that needs it, and the `type#relation` spelling is kept free for it.
