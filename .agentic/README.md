# Agentic OS pilot

CoThinker is a pilot consumer of [Agentic OS](https://github.com/mabrax/agentic-os), an
event-driven control plane for dispatching coding agents to work on GitHub issues.
Adding the `agent:ready` label to an issue dispatches a Claude Code Routine to
attempt the work; GitHub events drive the dispatch, and GitHub issue labels and
comments carry the durable workflow state. There is no polling process.

## Issue labels

- `agent:ready` — a human has authorized this issue for autonomous implementation
  work. Applying it is the only trigger; nothing else starts a dispatch.
- `agent:running` — an agent has claimed the issue and is actively working on it.
- `agent:needs-review` — the agent opened a pull request and is waiting on human
  review.
- `agent:needs-human` — the agent stopped because a decision or ambiguity
  requires human input before it can continue safely.
- `agent:dispatch-failed` — the dispatch itself could not be validated or
  started; the issue reverts to `agent:ready` for a human to retry or fix.

## Human authority

A human-applied `agent:ready` label authorizes an agent to implement the issue.
It never authorizes merging a pull request, closing the issue, or bypassing any
other human review gate. Every change an agent makes lands as a pull request for
a human to review and merge.
