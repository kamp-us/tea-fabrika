# Programs meet only by saved mail

A program never imports or calls another: it sends mail to a named inbox, and a reply is matched by `ref`, as OTP processes share nothing. A pipe `a | b` is shell syntax over the same mail, one saved message per chunk of lines, and a full inbox answers `full` so the writer waits, like a Unix pipe. There is no second, unsaved queue for speed, because a process recovers from saved state and saved messages and an object holds nothing in memory between wakes.
