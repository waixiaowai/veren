# Notification delivery

The host can send notifications to people who are not in this conversation.
That is a different act from answering the user, and it has rules.

## When to notify

Notify when something happened that a person needs to know about and that they
could not have learned otherwise: an order was paid, a build failed, a report
is ready. Do not notify to carry the conversation forward — that is what
replying in the conversation is for.

Before sending anything, ask whether it should be a notification at all. A
notification reaches someone who may not be waiting for it, and one that
arrives without a reason teaches the reader to ignore the next one.

## One workflow per kind of notice

A workflow is a notice type: its trigger identifier, its payload shape, its
steps, and its channels. Do not invent a workflow at the moment of sending.
Read `mail_workflows` first, and send by the trigger identifier it lists.

If no workflow fits what you need, say so rather than sending the closest
one. A workflow carries a payload schema; a payload that does not fit it is
rejected with the field path that failed.

The one exception is a genuinely new kind of notice that the user asked for
repeatedly. Then it is worth adding a workflow — and worth asking first,
because every workflow is a thing somebody has to maintain.

## Accepted is not delivered

`mail_send` answers whether the trigger was **accepted**. That means the
chain was created and the steps were queued. It does not mean the messages
arrived.

To learn what happened, read `mail_activity`. It reports one row per
execution chain, with each step's state and, for a step that did not run, the
reason:

| Reason | What it means | What to do |
| --- | --- | --- |
| `step_condition` | the step's conditions did not pass | the payload did not carry what the step asked for |
| `preference` | the recipient's own settings closed that channel | respect it; do not route around it |
| `missing_email` | the recipient has no address on that channel | give them one, or use another channel |

A skipped step is a decision the system made on the recipient's behalf, not
a failure to retry. Do not re-send to work around it.

## The recipient rules

A recipient that does not exist is refused. That is deliberate: a wrong
identifier means the message would have reached nobody, and a silent drop
would have looked like a delivery.

A group is a fan-out. Naming one reaches everyone subscribed to it, minus
the actor — the person who triggered the notice does not need to be told
about it. A recipient named twice receives one message.

## Preferences and quiet hours

Recipients decide which channels reach them. `mail_subscribers` shows what
they are reachable at. A `preference` skip means the recipient or their
operator closed that channel deliberately; treat it as a decision, not a
failure.

## Idempotency

Pass a `transactionId` when the call might be repeated — a retry, a loop, a
reconnect. A repeated transaction is refused rather than delivered twice.
Without one, the host cannot tell a retry from a new notice, and a duplicate
notification is worse than a failed one.

## The station inbox

`mail_inbox` reads what actually reached the station inbox. It is the
recipient's own view, with the seen, read, and archived states kept
independent of each other: a message that was seen but not read is still
unread.
