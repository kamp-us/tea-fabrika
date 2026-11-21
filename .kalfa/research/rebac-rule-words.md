---
summary: The words and syntax that Zanzibar, SpiceDB, OpenFGA, Ory Keto (OPL) and Permify use for facts, rules, "any of / all of / except", following a relation to another object, groups as subjects, agents acting for a human, request-only facts, one-holder-per-object and typed builders, plus Cedar and Oso where they answer; every claim cited
---

# What Zanzibar and its relatives call things, and how they model "A acts for B"

Question: `@kalfa/permissions` is a small TypeScript ReBAC (relationship-based access control) library on Zanzibar's model
(decision `.kalfa/decisions/0025-one-rebac-permission-system.md`, words in `kalfa/permissions/GLOSSARY.md`). The owner
wants every name and shape in its model language to match what the industry uses, so a person who knows SpiceDB or
OpenFGA feels at home. What do the main systems actually say?

Read on 2026-11-20. Primary sources only: the Zanzibar paper, each project's own docs and the source repos behind them,
proto files, and npm package files. A line marked "my reading" is mine, not a source's claim. Where I could not confirm
something, I wrote "not confirmed" and what I tried. The commit or version of each source is in the Sources list.

Systems covered: the Zanzibar paper (USENIX ATC 2019), SpiceDB, OpenFGA, Ory Keto with the Ory Permission Language
(OPL), Permify. Added where they have a clear answer: Cedar and Oso Cloud (Polar).

## The short answer

1. **Words for the two sides are not one word.** Zanzibar and OpenFGA say `object` and `user`. SpiceDB, Keto and Permify
   say `subject` for the holder. For the thing accessed, SpiceDB says `resource`, Keto says `object`, Permify says
   `entity`. Our glossary's `Subject` and `Object` match Keto exactly, and match Zanzibar and OpenFGA on `Object`.
2. **Everyone says "check" and "relation".** SpiceDB, Keto and Permify split stored links from computed rules in the
   language: SpiceDB has `relation` and `permission`, Keto has `related` and `permits`, Permify has `relation` and
   `action`/`permission`. The paper and OpenFGA have one word for both (`relation` in the paper, `define` in OpenFGA).
3. **"Any of / all of / except"** is `+ & -` in SpiceDB, `or and but not` in OpenFGA, `or and not` in Permify, `|| && !`
   in OPL and Cedar, and `union intersection exclusion` in the paper (OpenFGA's JSON says `difference` for the last).
4. **Following a relation to another object** is "tuple to userset" in the paper, `->` in SpiceDB, `X from Y` in OpenFGA,
   `relation.permission` in Permify, `.traverse(...)` in OPL. SpiceDB and OpenFGA state the operand order is reversed
   between them.
5. **Groups as subjects** are called a "userset" (paper, OpenFGA), a "subject relation" (SpiceDB), a "subject set"
   (Keto), and written `group#member` in all but Keto's TypeScript form `SubjectSet<Group, "members">`.
6. **"A acts for B" has documented patterns, and they differ.** The clearest one is AuthZed's own SpiceDB example: the
   link lives on the human (`user:tom#agent@ai_agent:assistant_tom`) and the document rule walks to it
   (`reader->delegates`). It is opt-in per permission, so an agent can get less than its human. See section 5.
7. **Request-only facts have two kinds.** OpenFGA and Permify accept whole tuples in the request ("contextual tuples").
   SpiceDB, Cedar and Oso accept values (SpiceDB calls them caveat context). Keto and the paper have neither.
8. **One holder per object** cannot be said in an OpenFGA model, and its docs say so outright. For SpiceDB, Keto and
   Permify I found no such feature (not confirmed either way). Cedar can say it, because an attribute that is one
   entity, not a set, holds one.
9. **No official typed TypeScript builder exists** for SpiceDB, OpenFGA or Permify. SpiceDB has a Go builder in its repo.
   OPL is TypeScript syntax with type definitions, so it is the nearest to a typed model language.

My confidence in items 1 to 5 is high, about 90%, because they come straight from reference pages. Item 6 is the
softest, about 70%, because the patterns are examples, not rules, and I did not run any of them.

## 1. Names for the fact, the sides, the rules, relation versus permission, the check and its answers

| System | The fact | The two sides | The declared rules | Relation versus permission |
|---|---|---|---|---|
| Zanzibar paper | "relation tuple": `object#relation@user` | "object" and "user" (a user is a user id or a "userset") | "namespace configuration", with "relation configs" and "userset rewrite rules" | one word, "relation"; no separate permission word |
| SpiceDB | "relationship": `document:readme#editor@user:emilia` | "resource" and "subject" | "schema", made of "object type definitions" (`definition`) | two keywords: `relation` (stored) and `permission` (computed) |
| OpenFGA | "relationship tuple": `user`, `relation`, `object` | "user" and "object" | "authorization model", made of "type definitions" (`type`); each `define` is a "relation definition" | one keyword, `define`; docs say "Permissions are relations that users get through other relations" |
| Ory Keto | "relationship" (the paper's tuple notation is shown as an alternative) | "subject" and "object" | OPL, one `class X implements Namespace` per "namespace" | `related` block (relations) and `permits` block (permissions) |
| Permify | "relational tuple": `entity#relation@user` | "entity" and "subject" | "Permify Schema", made of `entity` blocks | `relation` (stored, `@type`) and `action` or `permission` (computed); the two permission keywords are equivalent |

Where each word comes from:

- **Zanzibar.** "htuplei ::= hobjecti`#`hrelationi`@`huseri", "huseri ::= huser idi | huserseti", and "In Zanzibar, ACLs
  are collections of object-user or object-object relations represented as relation tuples" (section 2.1). A namespace
  config "specifies its relations", and each relation can carry "userset rewrite rules" (sections 2.3, 2.3.1). The paper
  has no word for a computed permission: its example config makes `viewer` a relation that includes `editor`.
  https://www.usenix.org/system/files/atc19-pang.pdf
- **SpiceDB.** "A **relation** ... represents a possible type of connection defined in your schema" and "A
  **relationship** is a specific instance of a relation - it's the actual data"
  (https://authzed.com/docs/spicedb/concepts/relationships). "A `relation` defines how two objects (or an object and
  subject) can relate to one another" and "A permission defines a _computed_ set of subjects"
  (https://authzed.com/docs/spicedb/concepts/schema). A relationship cannot point at a permission: "you cannot write a
  relationship that references a *permission*, only a relationship that references a *relation*" (same page).
- **OpenFGA.** "A **user** is an entity in the system that can be related to an object", "A **relationship tuple** is a
  base tuple/triplet consisting of a user, relation, and object", "An **authorization model** combines one or more type
  definitions" (https://openfga.dev/docs/concepts). On permissions: "Permissions are relations that users get through
  other relations" (https://openfga.dev/docs/modeling/roles-and-permissions). AuthZed's migration guide, a primary source
  on both systems, says: "OpenFGA uses one kind of name, `define`, for both stored and computed access, while SpiceDB
  separates them into relations and permissions"
  (https://authzed.com/docs/spicedb/migrate-to-spicedb/migrate-from/openfga). In my reading, the `can_` prefix on computed
  names (for example `define can_read: ...` in https://openfga.dev/docs/modeling/agents/agents-as-principals) is a
  convention, not a keyword.
- **Keto and OPL.** "`object` refers to the thing being accessed ... and `subject` refers to the entity requesting
  access", "Relations always run in one direction: a subject is in a relation _of_ an object", and the `related` block
  "declares which relations it can have". The `permits` block "defines permission functions, which return a boolean"
  (https://www.ory.com/docs/keto/reference/ory-permission-language). Relationships are shown as
  `User:alice is in viewers of File:readme` and the Zanzibar form `Group:group1#members@User:user1` is noted as the
  paper's notation (https://www.ory.com/docs/keto/concepts/relation-tuples).
- **Permify.** "In Permify, the simplest form of relational tuple structured as: `entity # relation @ user`"
  (https://docs.permify.co/getting-started/sync-data). "The keywords **_action_** or **_permission_** are equivalent"
  (https://docs.permify.co/getting-started/modeling). Its API names the sides `Entity` and `Subject` (type, id, optional
  relation) (https://github.com/Permify/permify/blob/18fcfdda52fdc93bef7b8de43474d26173e9d23f/proto/base/v1/base.proto).

**The question itself (check) and its answers.**

- **Zanzibar:** "Authorization checks take the form of 'does user U have relation R to object O?'" (section 1). The
  answer in the text is authorized or not; the paper shows no answer enum. A check names "a userset ... a putative user,
  often represented by an authentication token, and a zookie" (section 2.4.4).
- **SpiceDB:** `CheckPermission`. It also accepts a relation name. Three answers: `PERMISSIONSHIP_HAS_PERMISSION`,
  `PERMISSIONSHIP_NO_PERMISSION`, `PERMISSIONSHIP_CONDITIONAL_PERMISSION` ("required context is missing")
  (https://authzed.com/docs/spicedb/concepts/caveats and
  https://github.com/authzed/api/blob/b550d757d703fd39ea28799b30daa4de78cd1987/authzed/api/v1/permission_service.proto).
- **OpenFGA:** "check request". "The check endpoint responds with `{ "allowed": true }` ... and with `{ "allowed": false }`"
  (https://openfga.dev/docs/concepts).
- **Keto:** "Check API". Answer is a boolean `allowed`
  (https://github.com/ory/keto/blob/f50b4892b31d01d736720c7ec358db9a1bd3e724/proto/ory/keto/relation_tuples/v1alpha2/check_service.proto,
  https://www.ory.com/docs/keto/concepts/api-overview).
- **Permify:** "Check". The proto enum is `CHECK_RESULT_ALLOWED` and `CHECK_RESULT_DENIED`
  (https://github.com/Permify/permify/blob/18fcfdda52fdc93bef7b8de43474d26173e9d23f/proto/base/v1/base.proto). The docs'
  code samples still show `RESULT_ALLOWED` and `RESULT_DENIED`, so the docs and proto disagree on the name
  (https://docs.permify.co/api-reference/permission/check-api).

**Cedar and Oso, only where clear.**

- **Cedar** has no tuples. A request has a `principal`, an `action`, a `resource` and a `context`, and Cedar answers
  allow or deny. Rules are "policies" that `permit` or `forbid`
  (https://docs.cedarpolicy.com/overview/terminology.html, https://docs.cedarpolicy.com/policies/syntax-policy.html).
- **Oso Cloud (Polar)** stores "facts" such as `has_relation(Repository{"anvils"}, "parent", Organization{"acme"})`. A
  "resource block" has `permissions`, `roles` and `relations` keys
  (https://www.osohq.com/docs/modeling-in-polar/reference/resource-blocks). I did not confirm Oso's word for the answer.

**How our glossary lines up (my reading).** `Relationship`, `Relation`, `Permission`, `Check`: match SpiceDB, and
Keto for most. `Subject` and `Object`: match Keto exactly. `Model`: matches OpenFGA's "authorization model"; SpiceDB and
Permify say "schema", the paper says "namespace configuration". `Denied`: no system uses it; they say "no permission",
`allowed: false`, `DENIED` or "deny". Our glossary's `Avoid: tuple` fits SpiceDB and Keto, who say "relationship", but
the paper, OpenFGA and Permify all use "tuple" in their docs, so a reader from those will meet the word.

## 2. "Any of", "all of", "except"

| System | Any of (union) | All of (intersection) | Except (exclusion) |
|---|---|---|---|
| Zanzibar paper | `union` | `intersection` | `exclusion` |
| SpiceDB | `+` | `&` | `-` |
| OpenFGA | `or` (JSON `union`) | `and` (JSON `intersection`) | `but not` (JSON `difference`) |
| Keto OPL | `\|\|` | `&&` | `!` combined with `&&` |
| Permify | `or` | `and` | `not` |
| Cedar | `\|\|` | `&&` | `!`, and the `forbid` effect |

- **Zanzibar.** "A userset expression can also be composed of multiple sub-expressions, combined by operations such as
  union, intersection, and exclusion" (section 2.3.1). The config example is `userset_rewrite { union { child { _this {} }
  child { computed_userset { relation: "owner" } } } }` (Figure 1). The paper shows `union` in the example only; it does
  not show a text form of intersection or exclusion.
- **SpiceDB.** "Permissions support four kinds of operations: **union**, **intersection**, **exclusion** and **arrows**."
  Examples: `permission view = reader + writer`, `permission admin = reader & writer`,
  `permission can_only_read = reader - writer`. Warning: "For historical reasons, union (`+`) takes precedence over
  intersection (`&`) and exclusion (`-`)", so "`a + b & c` is evaluated as `(a + b) & c`"
  (https://authzed.com/docs/spicedb/concepts/schema).
- **OpenFGA.** "The **union operator** (`or` in the DSL, `union` in the JSON syntax)", "intersection operator (`and` ...
  `intersection`)", "exclusion operator (`but not` in the DSL, `difference` in the JSON syntax)". It prints a table
  mapping the paper's `union`, `intersection`, `exclusion` to these
  (https://openfga.dev/docs/configuration-language#equivalent-zanzibar-concepts). AuthZed notes OpenFGA "already requires
  parentheses when mixing operators"
  (https://authzed.com/docs/spicedb/migrate-to-spicedb/migrate-from/openfga).
- **Keto OPL.** "Combine checks with `||`, `&&`, and `!`", for example
  `this.related.allowlist.includes(ctx.subject) && !this.related.blocklist.includes(ctx.subject)`
  (https://www.ory.com/docs/keto/reference/ory-permission-language).
- **Permify.** "The Permify Schema supports **`and`**, **`or`** and **`not`** operators. These offer you permission
  **intersection** and **exclusion**." Example: `action comment = account.following not restricted` and
  `action delete = organization.admin and (owner or maintainer or organization.member)`
  (https://docs.permify.co/getting-started/modeling). Note the infix `not`: it reads "following, but not restricted".
- **Cedar.** `permit` and `forbid` are effects, not set operators. "An explicit `Deny` for any one policy ***always***
  overrides any `Allow` from other policies" (https://docs.cedarpolicy.com/policies/syntax-policy.html). Inside a
  condition, `&&`, `||` and `!` are the boolean operators
  (https://docs.cedarpolicy.com/policies/syntax-operators.html).
- SpiceDB adds two variants of the arrow, `.any(...)` and `.all(...)`; see section 3.

## 3. Following a relation from the object to another object

| System | Word | Short example from the docs |
|---|---|---|
| Zanzibar paper | "tuple to userset" (`tuple_to_userset`), with "computed userset" for the same object | `tuple_to_userset { tupleset { relation: "parent" } computed_userset { object: $TUPLE_USERSET_OBJECT relation: "viewer" } }` |
| SpiceDB | "arrow" `->`; aliases `.any(...)`, `.all(...)` | `permission read = parent_folder->read` |
| OpenFGA | "referencing relations on related objects", syntax `X from Y` (JSON `tupleToUserset`) | `define can_edit: owner or admin from organization` |
| Keto OPL | `.traverse(fn)` on a relation | `this.related.parents.traverse((p) => p.permits.view(ctx))` |
| Permify | dot path `relation.permission` | `action view = parent.view or manager` |

- **Zanzibar.** "tuple to userset: Computes a tupleset (§2.4.1) from the input object, fetches relation tuples matching
  the tupleset, and computes a userset from every fetched relation tuple. This flexible primitive allows our clients to
  express complex policies such as 'look up the parent folder of the document and inherit its viewers'" (section 2.3.1).
  "computed userset: Computes, for the input object, a new userset", for example `viewer` includes `editor` on the same
  object.
- **SpiceDB.** "The expression `parent_folder->read` indicates to 'walk' from the `parent_folder` of the `document`, and
  then to include the subjects found for the `read` permission of that folder." "Arrows operate on the **object** of
  the subject(s) found on a `relation`. They do **not** operate on the relation/permission of a subject." Recommended:
  "the right side of all arrows refer to **permissions**, instead of relations." `.all` "defines an _intersection_
  arrow": `permission view = group.all(member)` means a member of every group
  (https://authzed.com/docs/spicedb/concepts/schema).
- **OpenFGA.** "The syntax is `X from Y` and requires that: the other object is related to the current object as `Y`;
  the *user* is related to another object as `X`." Limit: OpenFGA "does not allow the referenced relation (the word after
  `from`, also called the tupleset) to reference another relation and does not allow non-concrete types (... wildcards or
  usersets) in its type restrictions" (https://openfga.dev/docs/configuration-language). That mirrors SpiceDB's "`#member`
  will be ignored". AuthZed's mapping table says `member from parent` becomes `parent->member`, and calls the reversed
  operand order "an easy translation mistake"
  (https://authzed.com/docs/spicedb/migrate-to-spicedb/migrate-from/openfga).
- **Keto OPL.** "`this.related.<relation>.traverse(fn)` takes a function and calls it for each object in `<relation>`.
  It returns `true` if the function returns `true` for any of them." The function can check a relation or "call another
  permission (`g.permits.<permission>(ctx)`)". Same-object reuse is `this.permits.isAdmin(ctx)`. There is no `all`
  variant in the docs (https://www.ory.com/docs/keto/reference/ory-permission-language).
- **Permify.** "The same traversal rule applies to both `relation.userset` and `relation.permission`. If a relation
  points to multiple entities, Permify evaluates the referenced relation or permission across all related entities."
  It documents a trap: `org.member and org.admin` can be met on two different organizations, so put the `and` on the
  organization and reference it (https://docs.permify.co/getting-started/modeling).
- **Cedar** walks a hierarchy, not a named relation: `in` "evaluates to `true` if the entity in the left operand is a
  descendant in the hierarchy under the entity in the right operand", and it is "transitive" and "reflexive"
  (https://docs.cedarpolicy.com/policies/syntax-operators.html).
- **Oso Cloud:** `"maintainer" if "internal_admin" on "parent";` (https://www.osohq.com/docs/modeling-in-polar/reference/resource-blocks).

## 4. A group as the subject of a relationship

| System | Word | Example |
|---|---|---|
| Zanzibar paper | "userset" (`object#relation`) | `doc:readme#viewer@group:eng#member` |
| SpiceDB | "subject relation" | `document:budget#owner@group:finance#member`, allowed by `relation owner: user \| group#member` |
| OpenFGA | "userset", written `<type>#<relation>` in a type restriction | `define viewer: [user, team#member]`; tuple user `folder:planning#editor` |
| Keto OPL | "subject set", `SubjectSet<N, R>` | `viewers: (User \| SubjectSet<Group, "members">)[]` |
| Permify | multiple relation types with `#` (the docs call this "feature locking" and "user set") | `relation maintainer @user @team#member`; tuple `organization:1#viewer@organization:O1#member` |

- **Zanzibar.** "huserseti ::= hobjecti`#`hrelationi", "a huserseti allows ACLs to refer to groups and thus supports
  representing nested group membership", and Table 1 reads `doc:readme#viewer@group:eng#member` as "Members of
  group:eng are viewers of doc:readme" (section 2.1).
- **SpiceDB.** The tuple above "can be read as: every object that has the `member` relation to `team:engineering` is an
  `editor`". The docs name it a "subject relation" and the written field `optional_subject_relation`
  (https://authzed.com/docs/spicedb/concepts/relationships, https://authzed.com/docs/spicedb/concepts/schema).
- **OpenFGA.** A user can be "a group or a set of users (also called a **userset**): e.g.
  `organization:org_ajUc9kJ#members`". Type restriction format `<type>#<relation>`: "`group:marketing#member` can be
  added if `group#member` is in the type restrictions" (https://openfga.dev/docs/concepts,
  https://openfga.dev/docs/configuration-language).
- **Keto.** "`SubjectSet<N, R>` refers to all subjects in relation `R` on namespace `N`." Written as
  `members of Group:engineering is in viewers of File:file1`. Subject sets "can again indirect to subject sets"
  (https://www.ory.com/docs/keto/reference/ory-permission-language, https://www.ory.com/docs/keto/concepts/subjects).
- **Permify.** "`@team#member` specifies that if the user has a relation with the team, this relation must be a `member`
  relation" (https://docs.permify.co/getting-started/modeling).
- **Cedar** has no usersets. A group is an entity in a hierarchy, and the caller sends it with the request: "the request
  must include the entities for the groups that Juan is a member of"
  (https://docs.cedarpolicy.com/overview/terminology.html).

## 5. "A acts for B": agents, bots, service accounts

Short answer: SpiceDB, OpenFGA and Cedar each document a pattern. Permify and Keto document none that I found. The paper
does not mention it. The patterns are different, and none of them is a built-in language feature.

| System | Documented pattern? | Shape |
|---|---|---|
| Zanzibar paper | none | not mentioned |
| SpiceDB | yes, AuthZed's example | link on the human, `human->delegates`, opt-in per permission |
| OpenFGA | yes, an "agents" section | agent is its own principal; the human check is a second check |
| Cedar | yes, best-practice page | agent as principal with the human in `context`, or the reverse |
| Permify | none found | a page named "impersonation" is about nested permissions |
| Keto | none found | nothing in the docs |

### SpiceDB

AuthZed's example repo has "AI Agents acting on behalf of a user", whose README says: "An AI agent inherits view access
to the documents a user can read or write, but cannot edit them on its own"
(https://github.com/authzed/examples/tree/3db7a04492d5ae7b07dc49060b6a4fa8da4ac6e6/schemas/ai-agents). The schema, from
that repo and shown on https://authzed.com/learn/spicedb-schema-examples/ai-agents:

```zed
definition user {
    relation agent: ai_agent
    permission delegates = agent
}
definition ai_agent {}
definition document {
    relation writer: user
    relation reader: user
    permission edit = writer
    permission view = reader + edit + reader->delegates + writer->delegates
}
```

Data: `user:tom#agent@ai_agent:assistant_tom` and `document:firstdoc#writer@user:tom`. Its own tests assert
`document:firstdoc#view@ai_agent:assistant_tom` is true and `document:firstdoc#edit@ai_agent:assistant_tom` is false.

My reading of this pattern:

- **The link is a relationship on the human**, with the agent as the subject: "users can have one or more AI agents that
  act on their behalf" (schema comment). No relation starts on the agent's side.
- **The walk goes through the object, then out from the human.** `reader->delegates` follows the document's `reader`
  relation to the human, then takes the human's `delegates` permission, which lists agents. So the arrow starts at the
  object, as always. It only reaches the agent side because the human is itself an object.
- **"Less than the human" is opt-in per permission.** `view` names `->delegates`. `edit` does not, so agents cannot
  edit. Each human relation that should flow to agents has to be named in each permission (here `reader` and `writer`).
- **It is not an intersection.** The agent does not need the human's permission "and" something else; it is given the
  human's access wherever the schema says so.

A second AuthZed page, the RAG demo, uses a smaller shape: `relation delegate: agent` on `user`, and
`permission view = viewer + viewer->delegate`, with the line "An agent can only view what the user it represents can
view" (https://authzed.com/ai-authorization/rag-demo; I read this page through a page fetch, not the repo, so the
wording is less exact). AuthZed's blog says "SpiceDB allows delegation to be represented as relationship data instead",
that "The child receives access only to the resources reachable through its own relationships", and "This does not make
delegation policy automatic" (https://authzed.com/blog/spicedb-secures-authorization-for-ai).

For services as subjects, the docs say the subject type should "be a representation of that service or its means of
providing its identity". A token can be a subject relation: `relation viewer: service#token`
(https://authzed.com/docs/spicedb/modeling/representing-users).

**Why an in-model "agent AND human" check is not available (my reading).** The SpiceDB typechecking section shows that
intersecting two relations whose subjects are different types, `permission edit = viewer & admin` with `viewer: user` and
`admin: serviceaccount`, "will _always_ return false at runtime because no relationship can simultaneously be for a
`user` subject and for a `serviceaccount` subject" (https://authzed.com/docs/spicedb/concepts/schema). A check has one
subject, so the ceiling "no more than the human may" has to be built as inheritance (the example above) or as two checks.

SpiceDB has a related keyword: `use self` and `permission view = viewer + self` make a subject match when it is the same
as the object, available from v1.49.0. Nothing in the docs ties it to delegation.

### OpenFGA

OpenFGA has a whole docs section, "Authorization for Agents". Its overview says agents "interact with internal APIs on
behalf of users, or with their own identity". Three pieces:

- **Agent as a principal** (https://openfga.dev/docs/modeling/agents/agents-as-principals). "model `agent` as a
  first-class principal - the same way users are granted access to resources today." The model allows `agent` where
  `user` is allowed: `define member: [user, agent]`. A tuple grants it: `user: agent:triage-bot`, `relation: member`,
  `object: project:alpha`. The agent has its own grants. Nothing links it to a human. For both, the docs say: "If you want
  to check for both user and agent permissions, perform a batch check".
- **Task-based** (https://openfga.dev/docs/modeling/agents/task-based-authorization). A `task` is the principal. The
  docs say: "your application needs to perform both user and task authorization. This means two separate checks: one to
  verify the user has access to a resource, and another to verify the task has permission". So the "no more than the
  human" ceiling is two checks in the app, not one rule in the model. Binding an agent to a task uses an intersection
  and a contextual tuple: `define can_call: [task] and task from calling_agent`, with the calling agent sent as
  `user: agent:1, relation: calling_agent, object: tool:slack_send_message` in the request. Sub-agents: "Share the
  task" or "Restrict further: create a new task with a narrower set of permissions". The model block is rendered by a
  script on the live page; I read it from the docs source.
- **ReBAC overview** (https://openfga.dev/docs/learn/rebac): "'Can this agent invoke this tool?' depends on whether the
  user who delegated to the agent has access to it." This is a sentence, not a model.

In OpenFGA's `task from calling_agent`, the walk still starts at the object (`calling_agent` is a relation on the tool).
It does not start at the subject.

### Cedar

Cedar's best-practice page has "Agents acting on behalf of a principal"
(https://docs.cedarpolicy.com/bestpractices/bp-using-the-context.html). Two patterns:

- "**Pattern 1: Agent as principal, user in context.** Use this when the agent's own permissions matter". Example
  `context = { "onBehalfOf": { "type": "MyApp::User", "id": "alice" } }`.
- "**Pattern 2: User as principal, agent in context.** Use this when the user's permissions are what matter, but you want
  policies that can restrict or audit which agents are allowed to act on their behalf." Example
  `context = { "viaAgent": { ... "id": "scheduling-bot" } }`.

"Choose the pattern based on which entity's permissions should be the primary authorization decision." Cedar's policies
can look at the principal's own attributes and parents (`principal in Group::"x"`), so Cedar is the one system here
whose policy language starts from the subject side. That is not ReBAC, because Cedar has no stored relationships.

### Permify, Keto, the paper

- **Permify.** The page `modeling-guides/rebac/impersonation` has the title "Inherited/Nested Permissions" and covers
  `permission group_member = group.member`, not impersonation (https://docs.permify.co/modeling-guides/rebac/impersonation).
  I searched the whole docs source for "delegat", "impersonat", "on behalf" and "service account". The only hits for
  "agent" are a sales-role example (`relation agent @user`). Not confirmed: any documented delegation pattern.
- **Keto.** I searched the Keto docs source for "delegat", "impersonat" and "on behalf". The one hit is the sentence "When
  you perform an action on behalf of a user, you should check for a specific permission" (about checking permissions, not
  delegation) (https://www.ory.com/docs/keto/modeling/create-permission-model). Not confirmed: any documented pattern.
- **Zanzibar paper.** I searched the text for "delegat", "imperson" and "service account": no hits.

### Does any system follow a relation from the subject side?

- In the Zanzibar family (paper, SpiceDB, OpenFGA, Permify, Keto) the rewrite operators in section 3 all start at the
  object being checked. I found no operator that starts at the subject. Where a subject-side link is needed, the docs use
  one of two routes: a userset or subject set on the human object (`user:alice#agent` as a subject, allowed in the
  type restriction), or a walk that reaches the human through the object's relation, as in AuthZed's `reader->delegates`.
- The first route is my reading: SpiceDB says arrows and subject relations "are mostly equivalent" and that "most ideas
  that can be expressed with a subject relation can be expressed with an arrow and vice versa"
  (https://authzed.com/docs/spicedb/concepts/schema). It does not show a human-object subject relation for delegation.
  In OpenFGA, a userset type restriction is explicit: `[user, team#member]`.
- Cedar starts at the principal (parents, attributes), as noted above.

## 6. Facts sent with a check and not stored

| System | Name | What it carries | Notable limits |
|---|---|---|---|
| Zanzibar paper | none found | nothing; a check takes a userset, a user and a zookie | not applicable |
| SpiceDB | "caveat context" | values, for a caveat (a CEL expression attached to a relationship) | 4096 bytes by default |
| OpenFGA | "contextual tuples", and request `context` for conditions | whole tuples; and values for a condition | 100 tuples per request; 512KB request |
| Keto | none | nothing; the check request has a tuple, `latest`, `snaptoken`, `max_depth` | not applicable |
| Permify | "contextual tuples", `context.data`, `context.attributes` | tuples, attributes, and a data map | not confirmed |
| Cedar | `context`, plus the `entities` list | a record of request values, and entity data | not confirmed |
| Oso Cloud | "context facts" | facts, true for one decision | not confirmed |

- **Zanzibar.** The paper has no request-time facts. I searched the text for "contextual" and "caveat": no hits. Its only
  per-check inputs are the userset, the user and the zookie (an opaque consistency token) (section 2.4.4).
- **SpiceDB.** "Caveats are expressions that can return true or false, and they can be attached (by name) to
  relationships" and the caveated relationship is "only ... considered present if the caveat expression evaluates to
  true at the time you run the `CheckPermission`". A check can send `context: { "user_ip": "1.2.3.4" }`. The caveat's
  context is "defined both by the values written in the `Relationship`, as well as those provided in the
  `CheckPermissionRequest`", and "the values in the `Relationship` take precedence". There is a third answer when context
  is missing: `PERMISSIONSHIP_CONDITIONAL_PERMISSION`. 64-bit integers are sent as strings
  (https://authzed.com/docs/spicedb/concepts/caveats). The limit flag: "`--max-caveat-context-size int` maximum allowed
  size of request caveat context in bytes ... (default 4096)"
  (https://authzed.com/docs/spicedb/concepts/commands). SpiceDB has no contextual tuples: "Contextual tuples are
  relationships passed with a request and never stored. SpiceDB's per-request data is caveat context, which carries
  values rather than relationships" (https://authzed.com/docs/spicedb/migrate-to-spicedb/migrate-from/openfga).
- **OpenFGA contextual tuples.** "Contextual tuples are tuples that can be added to a Check request, a ListObjects
  request, a ListUsers request, or an Expand request. They only exist within the context of that particular request and
  are not persisted in the datastore." Rules: "There is currently a limit of 100 contextual tuples per request", they are
  "validated using the same authorization model rules as stored tuples", and "the one in context takes precedence and
  the one in the DB is ignored" when user, relation and object match. Token claims used this way "will continue until
  token expiration even if the underlying claims ... change" (https://openfga.dev/docs/interacting/contextual-tuples).
- **OpenFGA condition context.** "the context written/persisted in the relationship tuple and the context provided at
  request time are merged together ... persisted context has higher precedence than request context". Limits: 32KB for
  context written with a tuple; 512KB overall request; a CEL cost cap of 100 by default
  (https://openfga.dev/docs/modeling/conditions).
- **Permify.** "Contextual tuples are relations that can be dynamically added to permission request operations ... they
  get processed alongside existing relations in the database" (https://docs.permify.co/operations/contextual-tuples).
  The API `Context` message has `tuples`, `attributes` and `data` (a `google.protobuf.Struct`)
  (https://github.com/Permify/permify/blob/18fcfdda52fdc93bef7b8de43474d26173e9d23f/proto/base/v1/base.proto). A rule
  reads the data map: `context.data.ip in ip_range`. Limits not confirmed: I found none in the docs.
- **Keto.** The check request message has no context field. For attribute-like data, the docs say the application "must
  map every incoming request to a subject string that represents the attributes of the request"
  (https://www.ory.com/docs/keto/concepts/subjects).
- **Cedar.** "The context field is intended for information unique to a particular request, such as http headers, time of
  day, the caller's authentication or device posture". The caller also sends all entity data the request needs: "the
  request must include the entities for the groups that Juan is a member of"
  (https://docs.cedarpolicy.com/bestpractices/bp-using-the-context.html,
  https://docs.cedarpolicy.com/overview/terminology.html).
- **Oso Cloud.** "These facts are considered true only for the duration of that decision and are not stored persistently."
  "If a context fact isn't provided, Oso checks the centralized fact storage instead"
  (https://www.osohq.com/docs/authorization-data/context-facts).

## 7. "This relation has exactly one holder per object"

**OpenFGA says plainly it cannot. For the other Zanzibar-family systems I found no such feature.** Cedar can say it
with a single-valued attribute.

- **OpenFGA says so in its own docs:** "In the current version, there is no way to state that there is only one owner in
  the authorization model. The application must limit this set of users to just one owner if that is a requirement"
  (https://openfga.dev/docs/modeling/getting-started).
- **SpiceDB:** not confirmed. I searched the whole docs source for "cardinal", "exactly one", "at most one", "only one",
  "single owner" and "one-to-one". The word "cardinality" appears only in a load-testing page about cost
  (https://authzed.com/docs/spicedb/ops/load-testing). The best-practices page says "Relations in SpiceDB are binary (a relation is
  present or it's not)" (https://authzed.com/docs/spicedb/best-practices). What the API gives the application is
  "preconditions" on writes (`MUST_MATCH`, `MUST_NOT_MATCH` against a filter), so an app can make a "write only if no
  owner exists" call atomic
  (https://github.com/authzed/api/blob/b550d757d703fd39ea28799b30daa4de78cd1987/authzed/api/v1/permission_service.proto).
  That is app-side, not a model rule.
- **Permify, Keto:** not confirmed. I searched each docs source for the same words and found no hits.
- **Zanzibar paper:** no. Its "lock tuple" is "a regular relation tuple used by clients to detect write races", not a
  cardinality rule (section 2.4.2, Write).
- **Cedar:** the schema separates one from many (my reading of its example): `personalGroup: Group` is exactly one entity, `delegate?: User` is
  "optional" (at most one), and `blocked: Set<User>` is many
  (https://docs.cedarpolicy.com/schema/human-readable-schema.html). Cedar is a policy system with entity data, not a
  relationship store, so this is data shape, not a relation.

## 8. Typed builders in a general-purpose language

**I found no official typed TypeScript builder for SpiceDB, OpenFGA or Permify.** Their tools are text languages plus
parsers, and clients that send the text or JSON.

| System | What exists | Names for the moves in sections 2 to 4 |
|---|---|---|
| SpiceDB | Go helper package in the server repo | `Union`, `Intersection`, `Exclusion`, `ComputedUserset`, `TupleToUserset`, `Namespace`, `Relation`, `AllowedRelation` |
| OpenFGA | TypeScript types for the JSON model, in the SDK | fields `union`, `intersection`, `difference`, `tupleToUserset`, `computedUserset`, `this` |
| Keto | OPL itself is TypeScript syntax, with a types package | `includes`, `traverse`, `SubjectSet<N, R>`, `\|\|`, `&&`, `!` |
| Permify | none found | not applicable |
| Cedar | JSON forms for policies and schema | not applicable |

- **SpiceDB.** The package `pkg/namespace` in the server repo builds schema objects in Go. Its comments: "TupleToUserset
  creates a child which first loads all tuples with the specific relation, and then unions all children on the usersets
  found by following a relation", and "Union creates a rewrite definition that combines/considers usersets in all
  children". Other functions: `Nil`, `Self`, `Rewrite`, `AllowedPublicNamespace`, `AllowedRelationWithCaveat`,
  `WithExpiration`
  (https://github.com/authzed/spicedb/blob/c77bad6d4a9eb967cfd0b8342d07be68d7d6dcd1/pkg/namespace/builder.go). The Node
  client `@authzed/authzed-node` is a gRPC client. The npm packages I found for `.zed` files are parsers
  (`@authzed/spicedb-parser-js`, `@schoolai/spicedb-zed-schema-parser`), not builders.
- **OpenFGA.** `@openfga/sdk` 0.9.8 ships TypeScript types for the JSON model: `Userset` has optional `this`,
  `computedUserset`, `tupleToUserset`, `union`, `intersection` and `difference`
  (https://unpkg.com/@openfga/sdk@0.9.8/dist/apiModel.d.ts). `@openfga/syntax-transformer` 0.2.3 converts between the DSL
  and that JSON ("parser from and to the OpenFGA JSON Syntax"); its exports are `validator`, `transformer`, `errors` and
  `utils` (https://unpkg.com/@openfga/syntax-transformer@0.2.3/dist/index.d.ts). These are types and converters, not
  builder functions. The docs say the DSL "compiles down to JSON before being sent to OpenFGA's API"
  (https://openfga.dev/docs/configuration-language).
- **Keto.** `@ory/keto-namespace-types` 0.13.0-alpha.0 is "TypeScript definitions for Ory Keto Namespaces". It declares
  `Array<T>.includes(element)` and `Array<T>.traverse(iteratorfn)`, the `namespace` interface with `related` and `permits`,
  and `Context`
  (https://unpkg.com/@ory/keto-namespace-types@0.13.0-alpha.0/index.d.ts). The model is written as TypeScript classes
  (`class File implements Namespace { related: {...}; permits = {...} }`), so an editor type-checks it. In my reading this
  is the closest an established system comes to a typed, general-language model, but it is a declaration file for
  Keto's own reader, not a library you call.
- **Permify.** The repo's `sdk/` folder holds `go`, `java`, `javascript`, `python` and `typescript` clients. I did not
  open them for schema-builder functions. Not confirmed: a builder.
- **Cedar** has JSON policy and JSON schema formats
  (https://docs.cedarpolicy.com/policies/json-format.html); these are data formats, not builders.
- **Searches:** I ran six npm searches (OpenFGA builder, OpenFGA TypeScript schema, SpiceDB TypeScript schema, Zanzibar
  TypeScript, ReBAC TypeScript, Keto OPL). Results were parsers, clients and a few small third-party authorization
  libraries; none was a builder for one of these systems. This is not an exhaustive search.

## 9. What this cannot tell us

- **How widely any pattern is used.** I read documentation and example repos. I did not measure which of the section 5
  patterns teams run in production, so "documented" does not mean "common".
- **Whether the patterns work.** I ran no check against SpiceDB, OpenFGA, Keto or Permify. The SpiceDB example's own
  assertions are in the repo, and I did not execute them. The OpenFGA agent models are rendered from docs source I read,
  not run.
- **The AuthZed RAG demo and AuthZed blog pages.** I read them through a page fetch that summarizes, so their quoted
  lines are less exact than the repo-sourced quotes. The SpiceDB schema example is exact, from the examples repo.
- **Permify's answer name.** The proto says `CHECK_RESULT_ALLOWED`; the docs say `RESULT_ALLOWED`. I did not run Permify
  to see which one a current server returns.
- **Oso and Cedar beyond the cited lines.** I read only the resource-block reference and the context-facts page for Oso,
  and the policy, terminology, context and schema pages for Cedar. I did not confirm Oso's word for its answer, its
  limits on context facts, or any Oso delegation pattern. Cedar's limits on context size are not confirmed.
- **Limits for Permify contextual tuples and Oso context facts** are not confirmed; I found none stated in the pages I
  read.
- **The paper's text form of intersection and exclusion.** The paper names them but shows only `union` in its config
  example, so the exact textproto field names for the other two are not confirmed from the paper alone.
- **Typed builders outside npm.** I searched npm and read the official repos named above. I did not search PyPI, Maven,
  crates.io or Go modules, and I did not check download counts, so "no widely used builder" is about what I found, not
  a ranking.
- **Whether a design should copy any of this.** This file lists words and shapes. It does not weigh them against our
  decision or glossary, beyond the short reading at the end of section 1.

## Sources

Read on 2026-11-20. Repo sources are pinned to the commit shown.

- Zanzibar paper, USENIX ATC 2019: https://www.usenix.org/system/files/atc19-pang.pdf (talk page:
  https://www.usenix.org/conference/atc19/presentation/pang)
- SpiceDB docs: https://authzed.com/docs/spicedb/concepts/schema, `/concepts/relationships`, `/concepts/caveats`,
  `/concepts/commands`, `/modeling/representing-users`, `/best-practices`, `/ops/load-testing`,
  `/migrate-to-spicedb/migrate-from/openfga`. Source repo `authzed/docs` at commit
  `3f30dafdf4f82bfa914b8e80a1854615a468340c` (`app/spicedb/...`): https://github.com/authzed/docs
- AuthZed pages: https://authzed.com/learn/spicedb-schema-examples/ai-agents,
  https://authzed.com/ai-authorization/rag-demo, https://authzed.com/blog/spicedb-secures-authorization-for-ai
- AuthZed examples repo at commit `3db7a04492d5ae7b07dc49060b6a4fa8da4ac6e6`, `schemas/ai-agents`:
  https://github.com/authzed/examples/tree/3db7a04492d5ae7b07dc49060b6a4fa8da4ac6e6/schemas/ai-agents
- AuthZed API protos at commit `b550d757d703fd39ea28799b30daa4de78cd1987`:
  https://github.com/authzed/api/blob/b550d757d703fd39ea28799b30daa4de78cd1987/authzed/api/v1/permission_service.proto
- SpiceDB server repo at commit `c77bad6d4a9eb967cfd0b8342d07be68d7d6dcd1`, `pkg/namespace/builder.go`:
  https://github.com/authzed/spicedb/blob/c77bad6d4a9eb967cfd0b8342d07be68d7d6dcd1/pkg/namespace/builder.go
- OpenFGA docs: https://openfga.dev/docs/concepts, `/docs/configuration-language`, `/docs/interacting/contextual-tuples`,
  `/docs/modeling/conditions`, `/docs/modeling/getting-started`, `/docs/modeling/roles-and-permissions`,
  `/docs/modeling/agents/agents-as-principals`, `/docs/modeling/agents/task-based-authorization`, `/docs/learn/rebac`.
  Source repo `openfga/openfga.dev` at commit `a0edd8361bc011ccfa0b573942430bb3b008c124` (`docs-site/...`):
  https://github.com/openfga/openfga.dev
- OpenFGA npm: `@openfga/sdk` 0.9.8, `@openfga/syntax-transformer` 0.2.3 (files read through unpkg.com).
- Ory Keto docs: https://www.ory.com/docs/keto/reference/ory-permission-language, `/keto/concepts/relation-tuples`,
  `/keto/concepts/subjects`, `/keto/concepts/api-overview`, `/keto/modeling/create-permission-model`. Source repo `ory/docs` at commit `4a8e1bb690e9538235095595eabd3fa72a82d571`
  (`docs/keto/...`). Protos: `ory/keto` at commit `f50b4892b31d01d736720c7ec358db9a1bd3e724`. npm
  `@ory/keto-namespace-types` 0.13.0-alpha.0.
- Permify docs: https://docs.permify.co/getting-started/modeling, `/getting-started/sync-data`,
  `/operations/contextual-tuples`, `/api-reference/permission/check-api`, `/modeling-guides/rebac/impersonation`,
  `/modeling-guides/rebac/hierarchies`. Source repo `Permify/permify` at commit
  `18fcfdda52fdc93bef7b8de43474d26173e9d23f` (`docs/...`, `proto/base/v1/base.proto`).
- Cedar docs: https://docs.cedarpolicy.com/overview/terminology.html, `/policies/syntax-policy.html`,
  `/policies/syntax-operators.html`, `/policies/json-format.html`, `/bestpractices/bp-using-the-context.html`,
  `/schema/human-readable-schema.html`. Source repo `cedar-policy/cedar-docs` at commit
  `e282513f887a0638482b9d7f8651fb4c25ee88c0`.
- Oso Cloud docs: https://www.osohq.com/docs/modeling-in-polar/reference/resource-blocks,
  https://www.osohq.com/docs/authorization-data/context-facts
- This repo, at `origin/main`: `.kalfa/decisions/0025-one-rebac-permission-system.md`, `kalfa/permissions/GLOSSARY.md`.
