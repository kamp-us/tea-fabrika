# Conversation

Hearing and answering people in a chat app someone else runs, or in a pull request's comments. Conversation carries
messages; what a message means, such as an ask, is the app's to decide. An app's own rooms, with members who join and
leave, are that app's and not this context's.

## Language

**Room**:
A named place in a chat app where people talk. A chat channel, a direct message and a pull request's comment list are
each one room. A room's name says which provider it is in: written as text, it is the provider's name, a colon, then
the provider's own id.
_Avoid_: channel, chat, conversation, discussion, a thread for the whole talk

**Thread**:
The replies under one message in a room. The comments under one line of code are a thread in the pull request's room.
_Avoid_: sub-thread, reply chain, a room

**Place**:
Where a message goes: a room, or a thread in it.
_Avoid_: target, destination, channel

**Message**:
One thing a speaker said in a room: its body, its account, its speaker and when it was said.
_Avoid_: comment, post, chat line, note

**Body**:
What a message says: Markdown text and mentions, in order. Each provider writes a mention its own app's way.
_Avoid_: content, text, payload, words

**Account**:
The name a chat app knows someone by. Every message has one; the provider reads it and the message never claims it.
_Avoid_: user, handle, login, author, a speaker

**Speaker**:
Who said a message: the human Identity knows behind an account. An agent has no account of its own in a chat app, so an agent is never a speaker.
_Avoid_: sender, author, user, a bare `by` (the field is `speaker`)

**Unknown speaker**:
An account that matches no human. An unknown speaker may ask for nothing.
_Avoid_: anonymous, guest, stranger

**Reply**:
A message we post into a place. It answers the room or the thread, not one message inside it.
_Avoid_: respond, answer, send, post

**Reply id**:
The name the asker gives a reply before it is posted. The same reply id is the same reply, so asking again posts
nothing new. A reply id is public: a provider may write it into the message where the chat app's people can read it.
_Avoid_: idempotency key, nonce, request id, message id (a message's own id comes from the chat app)

**Undeliverable**:
How a reply ends when the chat app refuses it for good, such as a locked thread or a room that is gone. It is
written down once and never tried again; the asker reads the ending and decides what to do.
_Avoid_: failed, dropped, bounced, dead letter

**Mention**:
A part of a body that names an account, such as the bot's, so that they hear it.
_Avoid_: ping, tag, at, highlight

**Anchor**:
What a thread is about, such as one line of a file at one commit. Conversation keeps it and never reads it; Code
hosting's words fill it in. A plain chat thread has none.
_Avoid_: position, location, context, target

**Provider**:
The code that connects Conversation to one chat app or host, such as a chat app or a code host's comments. It turns that
app's words into these, and carries its own name.
_Avoid_: platform, integration, backend, connector, client

**Feature**:
Something a provider may offer beyond rooms, messages and replies, such as starting a thread under a message. A provider
lists its features, and an action on a feature it does not offer is not offered, which the asker must handle. A feature
gets its word here only once a job needs it.
_Avoid_: capability, support, ability, flag
