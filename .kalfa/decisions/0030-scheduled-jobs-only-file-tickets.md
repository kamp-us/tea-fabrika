# A scheduled job is a program on an alarm, and it only files tickets

A scheduled job waits on its own object's alarm, as Elm's `Time.every` does; there is no second scheduler and no Cron Triggers, which do not run in local development. A job never changes code: it files a ticket, and everything after goes through the normal steps.
