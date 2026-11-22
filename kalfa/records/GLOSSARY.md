# Records

How a repo keeps the docs its agents read: what kinds there are, where each kind lives, and what goes in it. Any repo with agents has this need; which kinds a repo keeps is its own data.

## Language

**Record kind**:
One kind of record a repo keeps, with its name, the folder it lives in, its prompt, and where its records' summaries come from.
_Avoid_: record type, collection, folder

**Record**:
One file of a record kind, such as one decision or one runbook.
_Avoid_: context doc, note, entry

**Prompt**:
A record kind's rules in plain words, the one place that says what goes in a record of that kind and how to write one.
_Avoid_: rules, schema, description

**Summary**:
A record's one line in its kind's list, so an agent can pick a record without opening it. It is the record's first heading, or a field of its frontmatter its kind names.
_Avoid_: gist, title, description

**Data**:
The facts a record holds for code to read, such as a decision's status. They sit in the record's frontmatter, and
the rest of the record is free text for people.
_Avoid_: metadata, fields, properties

**Shape**:
A record kind's rule for its records' data: which facts a record must hold and what each may be. A kind with no
shape asks nothing of its records' data.
_Avoid_: schema, format, template
