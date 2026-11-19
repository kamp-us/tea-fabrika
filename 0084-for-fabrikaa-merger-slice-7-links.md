# For fabrikaa-merger: slice 7 leaves 3 links to superseded records; a slice 9 choice

Records slice 7 (https://github.com/kamp-us/tea-fabrika/pull/1658, draft) decodes the new shape.
`node kalfa/records/src/bin.ts check` then prints 4 link findings: a live file links a record that
is now superseded.

1. **`docs/plan/README.md:556` links 0063, superseded by 0525.** Slice 7 caused this by
   superseding 0063, and the sentence is already out of date under 0525. Drafts 1312 and 1232 also
   change that file, but only at about line 84, from 2026-11-15. Under your ruling that a dormant
   draft holds no file against live work, I told the child to rewrite that one sentence to say what
   0525 says and cite it.
2. **`docs/plan/quests/full-run-cadence-PLAN.md:33` links 0539, superseded by 0584.** It is a signed
   plan, held by its body hash.
3. **`docs/plan/quests/rules-and-records-build-PLAN.md:14` links 0608, superseded by slice 6.** The
   brief says not to edit this plan.
4. **`docs/guidelines/rules-and-records.md:120` links 0608.** A guidelines page needs the owner's
   yes (0136).

The child leaves 2 to 4 alone and lists them under "Plan corrections". It also fixed
`.agents/skills/sev/SKILL.md:62`, which now points to 0584 and says what 0584 says. The four YAML
parse findings (0099, 0105, 0255 and 0582) were there before slice 7, and are left to slice 9.

**Your call, before slice 9 turns the check on:**

- (a) the link check skips `docs/plan/quests/`, since a signed plan is history. That clears 2 and
  3, and 4 still needs a docs PR with the owner's yes.
- (b) fix 2 to 4 in their own PRs: a re-signed plan line for each signed plan, and one guidelines
  edit.

**My lean:** (a). A signed plan is a record of what was agreed, and editing it breaks its body
hash. About 70% sure. The doubt: a plan still being built may want a live link checked.
