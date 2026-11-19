# Tickets live on our ledger, and GitHub only holds code

A ticket is a stream of facts on fabrika's own ledger, and only members of the ledger can file or edit one, so agents only read text a member wrote: that is our guard against prompt injection. GitHub stays the code host and gets no copy of tickets; a step reads its ticket from the ledger, never from a pull request body.
