# Conversation

Talking with people in a thread, in a chat app or in a pull request's comments. Conversation carries messages; what a
message means, such as an ask, is the app's to decide.

## Language

**Thread**:
An ordered list of messages people post into. A chat channel, a chat thread, a direct message, a pull request's
comment list and the comments under one line of code are each one thread.
_Avoid_: channel, room, chat, conversation, discussion

**Message**:
One thing a speaker said in a thread: its words, its speaker and when it was said.
_Avoid_: comment, post, chat line, note

**Speaker**:
Who said a message: the human or agent Identity knows behind a chat app's account. The provider finds it from the
account; the message never claims it.
_Avoid_: sender, author, user, account, a bare `by` (name the field: `spokenBy`)

**Unknown speaker**:
A speaker the provider could not match to any human or agent. An unknown speaker may ask for nothing.
_Avoid_: anonymous, guest, stranger

**Reply**:
A message we post into a thread. It answers the thread, not one message inside it.
_Avoid_: respond, answer, send, post

**Mention**:
A message naming someone, such as the bot, so that they hear it.
_Avoid_: ping, tag, at, highlight

**Anchor**:
What a thread is about, such as one line of a file at one commit. Conversation keeps it and never reads it; Code
hosting's words fill it in. A plain chat thread has none.
_Avoid_: position, location, context, target

**Reaction**:
One emoji a speaker puts on one message, or takes off. Conversation carries only who put which emoji on which message;
what an emoji means, such as "go", is a setting of the app.
_Avoid_: emoji response, ack, vote, like

**Provider**:
The code that connects Conversation to one chat app or host, such as a chat app or a code host's comments. It turns that
app's words into these.
_Avoid_: platform, integration, backend, connector, client

**Feature**:
Something a provider offers beyond threads and messages, such as reactions, anchors, editing or attachments. A provider
that does not offer a feature has none of it; a feature gets its word here only once a job needs it.
_Avoid_: capability, support, ability, flag
