# A machine that runs jobs has its own key, and asks for each job

A machine that runs jobs signs in with its own kind of key, `hands`, granted by a person key, which may take and report jobs and nothing else. Work reaches a machine only when it calls `jobs.take`: nothing is pushed to a client that did not ask. On every take the gateway checks the grant (may), the machine's declared abilities (can) and the call itself (willing), each from its own source.
