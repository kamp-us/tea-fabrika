# The parent holds every right, and an agent's sandbox holds only its login

An agent's sandbox holds only its own model login. Commit, push, open a pull request, or comment on a ticket are each a tool call the parent checks against a schema and the ticket, then runs with keys the sandbox never sees; for `git push` the sandbox has a stand-in token that a proxy at its network edge swaps for a real one-hour, one-branch token. Each new right costs one tool to write and test.
