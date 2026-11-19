# An agent hands fabrika a flow as data, and the loop stays fabrika's

When an agent wants to compose work, it writes the steps down as data and hands them over; fabrika checks the flow, runs it as a process and records each step, so the work goes on after the agent's session ends. A handed-over flow gets at most its caller's rights and never a key. The API an agent composes against is libfabrika's public one: an agent is one more client.
