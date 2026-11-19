---
summary: How strong teams write and keep runbooks (what goes in one, when it is written and updated, how it stays fresh and gets found, how it differs from playbooks, checklists and postmortems) and what changes when an agent follows one; every claim cited
---

# How teams write and keep runbooks, for people and for agents

Question: how do strong engineering teams write and keep runbooks, especially runbooks that agents, not only people,
will follow?

Read on 2026-11-18, from the pages linked on each line and listed at the end. A line marked "my reading" is mine, not a
source's claim. Where a number is quoted, it is the source's own number, not something I could check.

## The short answer

Five findings matter most for a skill that writes runbooks for agents.

1. **Fix the words first, and keep a runbook apart from a playbook.** AWS says a runbook "executes a known procedure to
   reach a known outcome" and a playbook "guides investigation when the outcome is not yet known". It adds: keep the two
   separate "so a runbook does not become an open-ended troubleshooting guide"
   ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)). Other sources use
   the same two words differently (section 1), so a skill has to define its own.
2. **Every step carries an action, an owner and a proof.** Azure's failover runbook is a table of Action, Owner and
   Criteria ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)).
   AWS's agent guide asks a skill to "document expected outputs and success criteria"
   ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)). A
   rollback nobody tested "lengthened the outage" at Google
   ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)).
3. **Staleness is handled by habits, and the best habit ties the edit to the change.** Google: details "go out of date
   at the same rate as production environment changes"
   ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)). AWS: tie updates to change management, name an owner,
   keep one copy in version control ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).
   Google also says to turn a deterministic list of commands into automation.
4. **A runbook is found from its trigger, and an agent finds it by its description.** Alerts link to the runbook
   ([PagerDuty](https://docs.pagerduty.com/ops-guides/incident-response-guide/alerting-principles)). For agents, "a vague
   or missing description can cause the agent to skip the Skill entirely, even if the instructions are well-written"
   ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)).
5. **For an agent, match how tight the steps are to how dangerous the job is, check inputs, and let a person approve at
   first.** Anthropic's "narrow bridge" rule says exact steps where there is one safe way
   ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)). Google's
   worst automation failure came from a missing sanity check: "sometimes zero does mean all"
   ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)). Azure advises to "start with
   advisory mode and progressively enable automation as trust builds"
   ([Azure incident response guide](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/incident-response)).

Section 7 turns these into a short list of choices for a runbook skill here, with a confidence on each.

## 1. The words: runbook, playbook, checklist, postmortem

The sources do not share one meaning for "runbook" and "playbook". That is the first thing to know.

| Source | "Runbook" | "Playbook" |
|---|---|---|
| [AWS](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html) | A documented procedure with the same outcome "no matter who runs it" | Investigation when the outcome is not known; it points to the runbook that fixes a known cause |
| [PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/) | A detailed how-to for a commonly repeated task; manual, semi-automated or fully automated | The overall response to a larger event; "can include multiple runbooks and team members" |
| [Google SRE Workbook](https://sre.google/workbook/on-call/) | Not their term for this | A per-alert entry: severity and impact, debugging suggestions, actions to mitigate and resolve |
| [GitLab handbook](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/) | Their older, per-service docs, which "tend to be more architectural documents" | Their newer, per-alert docs; they are moving from the first to the second |

- **Runbook versus playbook.** AWS makes the playbook the investigation that comes first. PagerDuty makes it the wider
  plan that holds several runbooks. Both make the runbook the narrow procedure. Google and GitLab use "playbook" for one
  entry per alert that holds both diagnosis and fixes. My reading: the safe course is to say in the skill what each word means here, and not to lean on any one vendor's
  meaning.
- **Runbook versus checklist.** AWS: "At its simplest, a runbook is a checklist to complete a task"
  ([AWS OPS07-BP03](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_use_runbooks.html)).
  The Gawande and Boeing "Checklist for Checklists" is firmer: "A checklist is NOT a teaching tool or an algorithm"
  ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
  A checklist is a short list of critical checks. A runbook can hold a checklist, plus the tools, permissions, error
  handling and escalation around it.
- **Runbook versus postmortem.** A postmortem is "a written record of an incident, its impact, the actions taken to
  mitigate or resolve it, the root cause(s), and the follow-up actions"
  ([SRE book, Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)). It looks back. A runbook looks
  forward. They meet in two places: postmortems "show where a runbook would help most"
  ([PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/)), and Google asks teams to "Hold yourself
  and others accountable to following up on the specific actions detailed in these postmortems"
  ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)). My reading: a wrong runbook step is
  one such action.
- **Runbook versus how-to guide.** Diátaxis defines a how-to guide as directions that guide the reader "through a
  problem or towards a result", that help "get something done, correctly and safely"
  ([Diátaxis](https://diataxis.fr/how-to-guides/)). My reading: a runbook is a how-to guide for an operation, with an
  owner and a trigger added.
- **Runbook versus incident process.** Google separates the per-alert playbook from the incident protocol, which names
  roles and keeps a live state document ([SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/)).
  PagerDuty's ops guide does the same, with its own roles and postmortem pages.

## 2. What goes in one

### Outcome, trigger and scope

- State the desired outcome first, then the tools and permissions, then the steps
  ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)). AWS's template
  header holds: ID, description, tools used, special permissions, author, last updated and escalation contact.
- Say when to use it. GitLab's per-alert playbook opens with "what the alert means and what action the EOC is expected
  to take" ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
  Azure's DR plan lists "activation criteria and approvals": what counts as a DR event and who may start it
  ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)).
- Keep one job per runbook. Gawande's account of the ICU checklist: Pronovost "didn't attempt to make the checklist
  cover everything" and went after one problem, line infections
  ([The Checklist, New Yorker](https://www.newyorker.com/magazine/2007/12/10/the-checklist)). AWS keeps runbooks apart
  from troubleshooting guides for the same reason.

### Steps

- Ordered, short and each one a specific action: "Actionable, with a specific response required for each item"
  ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
- Short lists. The same PDF asks for "fewer than 10 items per pause point". The WHO surgical checklist manual says
  "Five to nine items in each Checklist section are ideal" and no more than a minute per section
  ([WHO manual, a copy hosted by the Leapfrog Group](https://www.leapfroggroup.org/sites/default/files/Files/WHO_SafeSurgeryChecklistImplementationManual.pdf)).
- Include only steps that are critical and "not adequately checked by other mechanisms"
  ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
- A checklist step needs the means to do it. In Michigan's ICU rollout, hospital executives found the antiseptic soap
  "was available in fewer than a third of the I.C.U.s" and the full-size drapes were often missing, so a step could not
  be done as written until supplies were fixed ([The Checklist, New Yorker](https://www.newyorker.com/magazine/2007/12/10/the-checklist)).
  My reading: a runbook should list what must exist before step one, and check it.

### A check that proves each step worked

- Azure's runbook table pairs each action with an owner and a criterion. Its first row is: detect incident, owned by
  Monitoring/Operations, with the criterion "The incident is triggered by alerts or user reports"
  ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)).
- AWS's agent guide says a skill should "document expected outputs and success criteria" and "include decision trees for
  different scenarios" ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)).
- Anthropic's skill guide uses a loop: run a validator, fix the errors, repeat, and "only proceed when validation
  passes" ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).
- The checklist PDF asks that a checklist "detect errors at a time when they can still be corrected"
  ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
- GitLab asks for "verification information to ensure the alert is accurate", such as dashboards and log queries
  ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
- Proof also applies to the runbook as a whole. Pronovost's team first had nurses watch real line insertions. In "more
  than a third of patients" at least one step was skipped, which showed the checklist was needed
  ([The Checklist, New Yorker](https://www.newyorker.com/magazine/2007/12/10/the-checklist)).

### When a step fails, and rollback

- AWS: "Include error handling for when a step fails and an escalation path for when the procedure cannot resolve the
  problem" ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).
- A runbook has an edge. In a PagerDuty incident told in the Google SRE Workbook, the on-call engineer "completed the
  mitigation steps in relevant runbooks", the incident went on, and "when the procedures in our runbooks didn't resolve
  the issue" the team moved to new options "in a methodical manner"
  ([SRE Workbook, Incident Response](https://sre.google/workbook/incident-response/)).
- Rollback: Azure's DR runbook names "failover and failback procedures" and "criteria for initiating failback"
  ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)). GitLab
  asks for links to recent changes and, "if relevant, also include information on rolling back said changes"
  ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
- Test the rollback. In a Google test that went wrong, "Because we hadn't tested our rollback procedures in a test
  environment, these procedures were flawed, which lengthened the outage. We now require thorough testing of rollback
  procedures before such large-scale tests" ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)).

### Who acts

- Each action has an owner, in Azure's table above. AWS asks to "Name an owner so responsibility for keeping the
  runbook current is clear" and to list an escalation contact
  ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).
- During an incident only one group changes the system. Google: "The operations team should be the only group modifying
  the system during an incident." A separate commander holds state and delegates
  ([SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/)). The same chapter's
  illustrative story has an engineer who "didn't coordinate with his coworkers" and whose changes "made a bad
  situation far worse".
- One owner for follow-up. PagerDuty: "It is important to designate a single owner to avoid the bystander effect"
  ([PagerDuty postmortem basics](https://docs.pagerduty.com/ops-guides/postmortem-best-practices/what-is-a-postmortem)).
- Anyone can stop the line. Pronovost's hospital "authorize[d] nurses to stop doctors if they saw them skipping a step"
  ([The Checklist, New Yorker](https://www.newyorker.com/magazine/2007/12/10/the-checklist)).

### What to leave out

- Teaching. "A checklist is NOT a teaching tool or an algorithm"
  ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
  Google's on-call learning checklist deliberately "does not directly encode procedures, diagnostic steps, or playbooks"
  so it stays "relatively future-proof" ([SRE book, Accelerating SREs](https://sre.google/sre-book/accelerating-sre-on-call/)).
- Architecture tours. GitLab found its service runbooks "tend to be more architectural documents or contain many links to
  unrelated information without much troubleshooting guidance"
  ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
- Dates in the body that go wrong. Anthropic's skill guide says not to write "before August 2025, use the old API", and
  to keep old methods in a collapsed "old patterns" section
  ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).

### One wider shape, for a service

PagerDuty passes on Tom Limoncelli's seven sections for a service's runbook: overview, build, deploy, common tasks, a
"pager playbook" of every alert, disaster recovery, and the service level agreement
([PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/)). I could only reach this through
PagerDuty's page, not Limoncelli's own text.

## 3. When it is written, and when it is updated

**Written**

- After the work has been done for real, from what actually happened. PagerDuty: "Detailed incident reports and
  postmortems show where a runbook would help most", and its ticket system "can also reveal common, recurring tasks"
  ([PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/)). Azure's SRE Agent tutorial:
  "The best knowledge documents come from real investigations"
  ([Azure SRE Agent tutorial](https://learn.microsoft.com/en-us/azure/sre-agent/tutorial-upload-knowledge-document)).
- With the alert, not after it. Google: "whenever an alert is created, a corresponding playbook entry is usually
  created", and "Each alert should have a corresponding playbook entry"
  ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)). GitLab: "the service owners adding the alert should
  create a playbook before the alert is added"
  ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
- Starting small. AWS: pick "a process that runs semi-regularly, has a small number of steps, and fails with low
  impact", so the habit and template exist before the costly procedures
  ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).
- Before the emergency. Google: "Develop and document your incident management procedures in advance"
  ([SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/)). The Workbook adds: "when the world
  is not on fire" ([SRE Workbook, Incident Response](https://sre.google/workbook/incident-response/)).

**Updated**

- When the thing it describes changes. AWS: "Tie runbook updates to your change management process"
  ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)). Google: for daily
  releases, "playbooks might need an update on any given day"
  ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)).
- When the alert fires. Google: "On-call engineers should update the playbook with fresh information when the
  corresponding page fires" ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)).
- After a rehearsal. Azure: "After every test ... update your architecture and runbooks promptly"
  ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)).
- After a postmortem. PagerDuty uses postmortems to decide where a runbook would help
  ([PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/)), and Google wants the postmortem's
  actions followed up ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)). My reading: a
  runbook fix belongs among those actions.
- Not by edit alone. PagerDuty lists as an anti-pattern updating documentation and "assuming everyone would read the
  documentation before an incident. Which of course, never happens", and says changes "need to be appropriately
  disseminated" ([PagerDuty anti-patterns](https://docs.pagerduty.com/ops-guides/incident-response-guide/anti-patterns)).

## 4. How it is kept from going stale

The sources agree that drift is the main failure. AWS lists "Runbooks drift out of sync with the systems and automation
they describe" as an anti-pattern and says "someone follows the stale version during an incident"
([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)). The means they give,
roughly from strongest to weakest:

1. **Tie the edit to the change.** AWS: updates follow change management. PagerDuty, on automation: it "travel[s] the
   software development lifecycle with the services that they support" in version control
   ([PagerDuty auto-remediation](https://docs.pagerduty.com/ops-guides/auto-remediation/getting-started)). GitLab keeps playbooks in the same repo as the
   alert rules, asks for the playbook before a new alert is added, and has you run `make generate` after any change to
   an alert or playbook ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
2. **One copy, in version control, with an owner and a date.** AWS: "a single known location stops copies from drifting
   apart"; the template carries "Last updated" and an escalation contact. Azure: "Treat your DR runbook like production
   code: version it and make it accessible." The checklist PDF asks that the "date of creation (or revision)" be marked
   and that you have "made plans for future review and revision"
   ([Project Check PDF](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf)).
3. **Use it, and fix it on use.** A second person runs the new runbook "using only the written steps" and fixes what is
   missing ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)). Google's
   Search SRE team (for its on-call learning checklist, not a runbook) sorts sections "by how up-to-date they are" and gives a newcomer the most outdated
   sections to overhaul, peer reviewed by named experts ([SRE book, Accelerating SREs](https://sre.google/sre-book/accelerating-sre-on-call/)).
   Rehearsal: Azure's regular drills, Google's "Wheel of Misfortune", PagerDuty's Failure Friday, which it uses to test new alerts ([PagerDuty alerting](https://docs.pagerduty.com/ops-guides/incident-response-guide/alerting-principles)).
4. **Keep the fast-moving part thin.** Google says its teams disagree: some keep entries "general so they change
   slowly", others want step-by-step to cut human variability. Its advice: "decide with your team what minimal,
   structured details your playbooks must have, and try to notice when your playbooks have accumulated a lot of
   information beyond these structured details" ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)).
5. **Replace a deterministic list with code.** "If your playbooks are a deterministic list of commands that the on-call
   engineer runs every time a particular alert fires, we recommend implementing automation"
   ([SRE Workbook, On-Call](https://sre.google/workbook/on-call/)). AWS agrees and adds: "Keep judgment calls, rare
   procedures, and steps that need human approval manual". The code then needs the same upkeep: PagerDuty says to plan
   how automation is "updated, tested, and released when new versions of your services are deployed", and AWS says to
   "keep the automated version and its documentation in sync".
6. **A switch to turn a stale one off.** In AWS DevOps Agent a skill can be set inactive, and "agents don't use an
   inactive skill until you activate it". Catalog skills "don't update automatically" until you sync them
   ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)).

Why humans do not catch drift alone. Google: "Outdated documentation is less of a problem for senior SREs ... because
they keep state on the world and its changes in their own heads"; newcomers need it most and "may not feel empowered" to
change it ([SRE book, Accelerating SREs](https://sre.google/sre-book/accelerating-sre-on-call/)). My reading: an agent
is the newcomer in this sentence. It has no memory of the world outside the page.

## 5. How it is found

- **From the alert.** Google's troubleshooting chapter opens with an alert that files a bug "with links to the black-box
  prober's recent results and to the playbook entry for this alert"
  ([SRE book, Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/)). PagerDuty: alerts
  must "Provide clear steps to resolve the problem, or link to a run book. Alerts with neither of these things are
  useless" ([PagerDuty alerting](https://docs.pagerduty.com/ops-guides/incident-response-guide/alerting-principles)).
  Prometheus rules take annotations for "runbook links"
  ([Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)), and Grafana names the
  annotation `runbook_url`, "the runbook page to guide operators managing a potential incident"
  ([Grafana](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/annotation-label/)). AWS: if
  playbooks are used for specific alerts, "provide your team with pointers to the playbook within the alert"
  ([AWS OPS07-BP04](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_use_playbooks.html)).
- **By the unit people act on.** GitLab moved from per-service runbooks to per-alert playbooks because the first "are not
  necessarily useful in determining what an alert means or how to handle it"
  ([GitLab](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)).
- **In one central place, and announced.** AWS: publish "in a central location", and "tell your team and stakeholders
  where to find it" ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).
- **Reachable when things are down.** Azure: make the runbook "always reachable, even during an outage", with offline
  or printable copies ([Azure DR guide](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)).
- **For an agent, by its description.** Anthropic: the description is "critical for skill selection", used to choose
  among "potentially 100+ available Skills", and should say what the skill does and when to use it, in third person
  ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)). AWS: "Write
  the description from the agent's perspective. Include the specific scenarios, services, error types, or symptoms that
  should trigger the Skill", so "investigating database latency, connection errors, or query timeouts for Amazon RDS
  instances" beats "RDS skill". Only the name and description load at start; the body loads when the skill looks
  relevant ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).
- **Two copies confuse an agent.** AWS: with a same-named skill from another source, "Agents might use only one of
  them, so delete the copy that you don't need" ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)).
- **A plain entry point for agents.** AGENTS.md calls itself "a README for agents: a dedicated, predictable place to
  provide the context and instructions" ([AGENTS.md](https://agents.md/)). PagerDuty puts a "Documentation index for AI
  agents" line at the top of its pages, pointing to an [`llms.txt`](https://docs.pagerduty.com/llms.txt).

## 6. What changes when an agent follows it

**Where vendors put agent runbooks.** As skills or knowledge files, in Markdown.

- AWS DevOps Agent: "Existing Runbooks are automatically migrated to Skills", and skills "encode your runbooks,
  architectural standards, and operational practices so the agent executes tasks consistently"
  ([AWS DevOps Agent guide](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)).
- Azure SRE Agent takes `.md` and `.txt` runbooks into its knowledge base, and can write a runbook from an investigation
  ([Azure first-value guide](https://learn.microsoft.com/en-us/azure/sre-agent/first-value)).
- Anthropic Agent Skills use a `SKILL.md` with a name and a description
  ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).

**What the format asks for.**

- AWS's Strands Agent SOP format (an open-source project, copyright Amazon) requires Overview, Parameters and Steps, allows
  Examples and Troubleshooting, and writes constraints in RFC 2119 words, MUST, SHOULD and MAY
  ([Agent SOP README](https://github.com/strands-agents/agent-sop) and
  [format rule](https://github.com/strands-agents/agent-sop/blob/main/rules/agent-sop-format.md)). Its rule on negatives:
  "you MUST provide context explaining why the restriction exists", for example "You MUST NOT run `git push` because this
  could publish unreviewed code to shared repositories".
- AWS DevOps Agent: say when and how to use it, "step-by-step investigation procedures", decision trees, and "expected
  outputs and success criteria".
- Anthropic: be concise (assume the model already knows common things), give a copy-and-tick checklist for multi-step
  work, and note that "Clear steps prevent Claude from skipping critical validation"
  ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).

**How tight to write the steps.** Anthropic's "degrees of freedom": "Narrow bridge with cliffs on both sides: There's only
one safe way forward. Provide specific guardrails and exact instructions (low freedom)", while an "open field with no
hazards" gets general direction ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).
Google adds a limit on step-by-step methods: heavy reliance on playbooks "works for industries that evolve and develop
relatively slowly", because the scenarios "are not constantly evolving due to system updates or changes"
([SRE book, Lessons from Other Industries](https://sre.google/sre-book/lessons-learned/)). My reading: Google's systems
change fast, and the Workbook's open argument over thin or step-by-step playbooks (section 4) is the same tension.

**Checks, stops and sanity checks.**

- Anthropic on agents: it is "crucial for the agents to gain “ground truth” from the environment at each step", with
  pauses for a person "at checkpoints or when encountering blockers" and "stopping conditions" such as a maximum number of
  iterations ([Building effective agents](https://www.anthropic.com/research/building-effective-agents)). It also says to
  make tools hard to misuse ("Poka-yoke your tools").
- Google's turndown automation sent every machine to be wiped because "the turndown automation server lacked the
  appropriate sanity checks on the commands it sent" and an empty filter matched all machines: "Yes, sometimes zero does
  mean all." The on-call engineers "disabled all team automation in order to prevent further damage"
  ([SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)). My reading: an agent runbook needs
  an input check for every step that picks targets, and a known way to stop all agents.

**Who approves.**

- Azure SRE Agent has two run modes, Review and Autonomous. "Review is the default mode." Modes are set "per response
  plan and per scheduled task", and the same page's table lists Autonomous as the default for a plan or task, so the
  default depends on where it is set. They control approval, while "Permissions control resource access"; the agent needs both
  ([Azure run modes](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes)). Production incidents are advised
  to use Review.
- PagerDuty's ladder: first the tool alerts a person who starts the automation; then the automation runs and still alerts
  a responder as a check; then it runs alone. Start with "well defined and well contained" targets, and measure whether
  alerts fell and whether incidents still resolve "in a timely and correct manner"
  ([PagerDuty auto-remediation](https://docs.pagerduty.com/ops-guides/auto-remediation/getting-started)).
- AWS: "Keep judgment calls, rare procedures, and steps that need human approval manual while you automate the repetitive
  core" ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).

**Resuming.** Strands SOPs can tell the agent to record progress, "making it easy to understand what's happening and
resume if something breaks" ([Agent SOP README](https://github.com/strands-agents/agent-sop)). The airline checklist
study says of the "do-list" method, where the list leads the work step by step, that "a mistake can easily pass
unnoticed once the sequence is interrupted", while the "challenge-response" method has the crew do the work first and
use the list to verify it ([NASA CR-177549](https://ntrs.nasa.gov/citations/19910017830)). My reading: an agent that loses
its place mid-runbook is in the same spot as an interrupted crew, so each step's proof should say how to tell, from the
world and not from memory, whether the step is done.

**Testing a runbook with an agent.**

- Anthropic: build evaluations first, test with "a fresh instance" on real tasks, watch where it struggles, and revise;
  test with each model you will use ("What works perfectly for Opus might need more detail for Haiku")
  ([Anthropic skill guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)).
- Azure suggests, for a handoff to an outside vendor, that AI "can role-play as a vendor team using only the
  documentation, playbooks, health models, and escalation paths the vendor has provided" to "reveal gaps, such as ...
  reliance on tribal knowledge"
  ([Azure incident response guide](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/incident-response)).
  My reading: this is the agent version of AWS's human check, "Give the draft to a team member who did not write it and
  have them perform the procedure using only the written steps"
  ([AWS OPS05-BP01](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)).

## 7. What this suggests for a runbook skill here

My reading, for the runbook skill and `.kalfa/runbooks/`. Nothing below changes any file. It is a list of choices.

I scanned the headings of all eight files in `.kalfa/runbooks/` and read two in full (`sev-main-is-red.md` and the top of
`refresh-native-stack-metadata.md`). All eight start with a `summary` line. Seven share the sections Trigger, Roles,
Steps as a checkbox list, Exit and Comms. `refresh-native-stack-metadata.md` has its own shape. From that read, against
the sources above, what they do not yet carry as a fixed part: a named proof beside each step (some steps state one in
prose), a rollback line (a text search found one `--undo` in one file), a "last verified" date, and a stated owner for the
runbook itself. I did not read the other six in full, so a gap may be filled in prose I missed.

1. **Give the skill one definition of runbook and one of playbook, and make the skill refuse open-ended diagnosis inside a
   runbook.** Why: sources split on the words, and AWS's "keep the two separate" is the only explicit rule. Cost: a
   second kind of record, or a place to send diagnosis. Confidence 80%.
2. **Put a proof beside every step, in the file.** Why: Azure's criteria column, AWS's success criteria, and the
   resume-after-interruption point all say the same thing. Cost: longer runbooks. Confidence 85%.
3. **Add "before you start" (what must exist) and "undo" (how to go back, and that it was tested) to the shape.** Why:
   Michigan's missing soap and Google's untested rollback. Cost: for some operations no undo exists, and the section must
   say so. Confidence 75%. The doubt is whether every runbook needs a rollback; a read-only one may not.
4. **Keep the freshness fields small and checked by code where a check is cheap: owner, last verified, and which source
   file or command it describes.** Why: tie-to-the-change is the strongest freshness habit in the sources. Cost: a
   check that can lie if the date is bumped without a read. Confidence 70%. The doubt: no source measures whether dates
   help, and a loose date check may be noise.
5. **Write the description as a trigger written from the agent's view, and keep one copy of each runbook.** Why: AWS and
   Anthropic both say discovery rides on the description, and duplicates make agents choose at random. Cost: low.
   Confidence 85%.
6. **Say, per runbook, how tight it is and who approves.** Narrow-bridge runbooks get exact commands and an approval
   point; open-field ones get direction. Why: Anthropic's rule, Azure's run modes and AWS's "judgment calls ... manual".
   Cost: someone must classify each runbook. Confidence 75%.
7. **Test a new runbook by giving it to a fresh agent with only the page, and fold the gaps back in.** Why: AWS's
   peer-validation step and Azure's role-play idea. Cost: agent hours per runbook. Confidence 70%. The doubt is that this
   is shown as a suggestion in the sources, not as a measured result.

## 8. What this cannot tell us

- **No controlled proof for agents.** Every agent source here is a product guide or an authoring guide. None reports a
  measured rise in success from following a runbook. The agent claims in section 6 are design advice, not results.
- **The 3x figure is Google's own claim.** The introduction says playbooks give "roughly a 3x improvement in MTTR" over
  "winging it", with no method or data given there
  ([SRE book, Introduction](https://sre.google/sre-book/introduction/)). I did not find the data behind it.
- **The checklist results are before-and-after studies.** Haynes and colleagues report deaths falling from 1.5% to 0.8%
  and complications from 11.0% to 7.0% after a surgical checklist in eight hospitals, comparing patients before and after, with no separate control group
  mentioned in the abstract ([NEJM 2009 abstract](https://pubmed.ncbi.nlm.nih.gov/19144931/)). Pronovost's team report the median bloodstream
  infection rate per 1000 catheter-days falling from 2.7 to 0 at three months, and the mean from 7.7 to 1.4 by 16 to 18
  months ([NEJM 2006 abstract](https://pubmed.ncbi.nlm.nih.gov/17192537/)). Hospitals are not on-call rotations, and
  Gawande's own piece says the first result came from one hospital with extra support.
- **Vendors sell the thing they describe.** PagerDuty, AWS and Azure pages come with automation products attached.
  Google and GitLab are operators writing about their own practice.
- **Gaps in what I could read.** I could not reach Limoncelli's own text for the seven sections. I read the WHO manual
  through a Leapfrog Group copy, not WHO's own site. The AWS DevOps Agent runbook page is script-rendered, so I read the
  product's PDF user guide. The AWS pages I cite for OPS07 are marked "historical reference" by AWS; I used OPS05-BP01
  for current wording. Azure's SRE Agent pages are in a fast-moving product, so details such as run-mode defaults may
  change. I did not read the Checklist Manifesto book itself, only Gawande's article and the Checklist for Checklists.
- **Not covered.** Security incident playbooks (NIST, CISA), runbook tools such as Rundeck, and chaos or game-day methods
  beyond what the sources above mention.

## Sources

Google

- [SRE book, Introduction](https://sre.google/sre-book/introduction/) (the playbook and MTTR claim)
- [SRE book, Effective Troubleshooting](https://sre.google/sre-book/effective-troubleshooting/)
- [SRE book, Emergency Response](https://sre.google/sre-book/emergency-response/)
- [SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/)
- [SRE book, Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)
- [SRE book, Accelerating SREs to On-Call and Beyond](https://sre.google/sre-book/accelerating-sre-on-call/)
- [SRE book, Lessons Learned from Other Industries](https://sre.google/sre-book/lessons-learned/)
- [SRE Workbook, On-Call](https://sre.google/workbook/on-call/)
- [SRE Workbook, Incident Response](https://sre.google/workbook/incident-response/)

PagerDuty

- [What is a runbook](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/)
- [Alerting principles](https://docs.pagerduty.com/ops-guides/incident-response-guide/alerting-principles)
- [Auto-remediation: getting started](https://docs.pagerduty.com/ops-guides/auto-remediation/getting-started)
- [What is a postmortem](https://docs.pagerduty.com/ops-guides/postmortem-best-practices/what-is-a-postmortem)
- [Anti-patterns](https://docs.pagerduty.com/ops-guides/incident-response-guide/anti-patterns)
- [llms.txt index](https://docs.pagerduty.com/llms.txt)

Checklists

- [The Checklist, New Yorker](https://www.newyorker.com/magazine/2007/12/10/the-checklist)
- [A Checklist for Checklists](https://www.projectcheck.org/uploads/1/0/9/0/1090835/checklist_for_checklists_final_10.3.pdf),
  credited by [Project Check](https://www.projectcheck.org/checklist-for-checklists.html) to Gawande's team and Dan
  Boorman of Boeing
- [Pronovost and others, NEJM 2006, abstract](https://pubmed.ncbi.nlm.nih.gov/17192537/)
- [Haynes and others, NEJM 2009, abstract](https://pubmed.ncbi.nlm.nih.gov/19144931/)
- [WHO Surgical Safety Checklist Implementation Manual 2009](https://www.leapfroggroup.org/sites/default/files/Files/WHO_SafeSurgeryChecklistImplementationManual.pdf)
  (a copy hosted by the Leapfrog Group)
- [Degani and Wiener, Human Factors of Flight-Deck Checklists, NASA CR-177549](https://ntrs.nasa.gov/citations/19910017830)

AWS

- [OPS05-BP01 Develop and test runbooks to perform procedures](https://docs.aws.amazon.com/wellarchitected/latest/framework/ops05-bp01.html)
- [OPS07-BP03 Use runbooks](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_use_runbooks.html)
  and [OPS07-BP04 Use playbooks](https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/ops_ready_to_support_use_playbooks.html)
  (an older pillar whitepaper)
- [AWS DevOps Agent user guide (PDF)](https://docs.aws.amazon.com/pdfs/devopsagent/latest/userguide/devops-agent-ug.pdf)
- [Strands Agent SOPs](https://github.com/strands-agents/agent-sop)

Microsoft

- [Azure Well-Architected: disaster recovery plan](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery)
- [Azure Well-Architected: incident management](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/incident-response)
- [Azure SRE Agent: first value](https://learn.microsoft.com/en-us/azure/sre-agent/first-value),
  [upload knowledge documents](https://learn.microsoft.com/en-us/azure/sre-agent/tutorial-upload-knowledge-document)
  and [run modes](https://learn.microsoft.com/en-us/azure/sre-agent/run-modes)

Agents and docs

- [Anthropic, Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Anthropic, Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [AGENTS.md](https://agents.md/)
- [GitLab handbook, Alert playbook management](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/alert-playbook-management/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
  and [Grafana alert annotations](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/annotation-label/)
- [Diátaxis, how-to guides](https://diataxis.fr/how-to-guides/)
