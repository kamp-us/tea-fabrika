# Every protocol is one a browser tab can speak

Every protocol between fabrika's pieces must be one a browser tab can speak: no raw TCP, no Unix socket, and nothing that only Node can call. A tab is the one client every person already has, so a protocol only a desktop process can speak would split fabrika into two apps, one of which a person may not be able to run.
