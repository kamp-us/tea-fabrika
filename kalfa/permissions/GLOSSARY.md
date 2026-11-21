# Permissions

What a subject may do. Who a subject is belongs to Identity, and limits such as spend or CPU are walls, not permissions. The words follow Zanzibar's paper and SpiceDB where they have one.

## Language

**Relation**:
A named kind of link between a subject and an object, such as owner or member. A model says which types of subject may hold it, whether one subject or many may hold it on one object, and which permission a change to it must pass.
_Avoid_: role (a role is one kind of relation), edge type

**Relationship**:
One fact linking a subject to an object by a relation, such as a human being a member of a project.
_Avoid_: tuple, row, edge, ACL entry

**Contextual relationship**:
A relationship the app passes with one check and vouches for, which is never kept. It carries a fact another context owns, such as which agents a human has.
_Avoid_: contextual tuple, context, claim, a kept copy of another context's fact

**Subject**:
The side of a relationship that holds the relation.
_Avoid_: principal, actor, user

**Object**:
The side of a relationship the relation is held on.
_Avoid_: resource, target, entity

**Model**:
The one declared set of object types, their relations, and the permissions built from them; each app has its own, and Permissions names no type, relation or permission itself.
_Avoid_: schema, policy, config

**Permission**:
A rule in the model, built from relations by union, intersection and arrow, that a step must pass a check for.
_Avoid_: right, grant, privilege, scope, ability, capability

**Union**:
A rule that holds when any one of its parts holds.
_Avoid_: any of, or

**Intersection**:
A rule that holds only when every one of its parts holds.
_Avoid_: all of, and

**Exclusion**:
A rule that holds when its first part holds and its second does not. It is named so the word is taken; no model can use it yet.
_Avoid_: except, but not, difference

**Arrow**:
A rule that follows a relation from the object to the subjects holding it, and holds when the checked subject holds a relation or permission on one of those.
_Avoid_: through, via, from, traverse, tuple to userset

**Proof**:
What a passed check gives back, sealed, so a step cannot run without it.
_Avoid_: grant, token, ticket

**Denied**:
What a failed check gives back in place of a proof.
_Avoid_: forbidden, unauthorized, rejected

**Role**:
A relation a human holds on a project, such as owner, admin or member. Which roles exist is each app's model.
_Avoid_: group, tier, rank

**Check**:
Running a permission against the relationships, kept and contextual, for one subject and one object, which gives a proof or denied.
_Avoid_: authorize, evaluate, within, can
