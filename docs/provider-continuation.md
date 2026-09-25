# Continue a conversation with another provider

On daemons that advertise provider switching, an existing conversation's model
picker includes other installed providers. Select a model under the desired
provider after the current turn and its provider subagents have stopped and any
permission requests are resolved. The switch does not send a prompt or consume a
model turn; send your next message to continue.

Paseo keeps the agent ID, workspace, working directory, title, labels and retained
conversation. It opens a new native session under the chosen provider and keeps
the old native handle in a private recovery record. This is context transfer, not
native session compatibility between providers. Provider-specific modes, thinking
settings and tool approvals are resolved for the target instead of copied from
the old provider. Configured creation hooks still apply.

The replacement receives a reference to the archived transcript with its first normal
prompt. It must read that transcript before first continuing and verify the
working tree. Failed or canceled attempts keep the handoff pending for retry. Original and replacement history are combined when the conversation
is reloaded, including after a daemon restart. Rewind is disabled for conversations
that span providers because one provider cannot rewind the other's history.

If target setup fails, the old native handle and transcript remain available for
retry. Missing retained history prevents the switch. Controller-owned executions
must be changed through their controller. Older daemons continue to show only the
current provider's models.

## Recover into a fresh conversation

Copy **Agent ID** from the conversation tab menu. In a fresh conversation invoke:

```text
/paseo-resume <agent-id>
```

The skill recovers the source conversation and continues the task in the receiving
session. The ID is scoped to its original daemon; include the host/home when that
is not the current daemon. This route also works when the source model cannot
prepare a handoff because its quota is exhausted. Retained local transcripts can
be located without starting the failed provider.

A quota error still requires available quota or another configured account/provider.
Reloading cannot reset quota. `Unknown sessionId` can result from launching a
provider against a different account's storage. Keep native resume bound to its
original profile, and use explicit continuation for account/provider changes.
