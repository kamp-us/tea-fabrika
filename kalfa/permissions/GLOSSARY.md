# Permissions

What a human or agent may do. Who they are belongs to Identity, and limits such as spend or CPU are walls, not permissions.

## Language

**Relation**:
A named kind of link between a subject and an object, such as owner or member.
_Avoid_: role (a role is one kind of relation), edge type

**Relationship**:
One fact linking a subject to an object by a relation, such as a human being a member of a fabrika.
_Avoid_: tuple, row, edge, ACL entry

**Subject**:
The side of a relationship that holds the relation.
_Avoid_: principal, actor, user

**Object**:
The side of a relationship the relation is held on.
_Avoid_: resource, target, entity

**Model**:
The one declared set of object types, their relations, and the permissions built from them; each app has its own.
_Avoid_: schema, policy, config

**Permission**:
A rule in the model, built from relations, that a step must pass a check for.
_Avoid_: right, grant, privilege, scope, ability, capability

**Proof**:
What a passed check gives back, sealed, so a step cannot run without it.
_Avoid_: grant, token, ticket

**Denied**:
What a failed check gives back in place of a proof.
_Avoid_: forbidden, unauthorized, rejected

**Role**:
A relation a human holds on a fabrika: owner, admin or member.
_Avoid_: group, tier, rank

**Check**:
Running a permission against the relationships for one subject and one object, which gives a proof or denied.
_Avoid_: authorize, evaluate, within, can
