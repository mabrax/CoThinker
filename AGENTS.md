# CoThinker project guidance

CoThinker is an experimental shared thinking space: a person and an AI discuss, draw on a shared canvas, and progressively turn accepted ideas into a design document. It is intentionally domain-general, not software-only.

## Working rules

- Keep browser voice interaction conversational and responsive; deeper reasoning should not block the live exchange.
- Treat the canvas as shared working material. AI-generated material should remain visually distinguishable and removable until accepted.
- Preserve the distinction between a proposal and a human-accepted design decision.
- Keep OpenAI credentials server-side. Do not put API keys in browser code, commits, fixtures, or screenshots.
- Run `npm run check` after code changes. Run `npm run test:e2e` for user-flow changes when practical.
- Do not commit generated folders such as `node_modules`, `dist`, or `test-results`.

## Product direction

- CoThinker is a spatial co-thinking environment, not Figma, Lucidchart, or a general diagramming editor. The canvas is the human's natural working memory for loose, spatial thought.
- Canvas organization is subordinate to thinking. Agents may propose additions, edits, connections, or organization only through visible, reversible, inspectable proposals; human acceptance remains authoritative.
- Keep the Realtime voice agent as a low-latency conversational gateway. Deeper decisions belong to a design-agent orchestrator that maintains the active goal and context, chooses whether to act directly or delegate, and returns proposals rather than silent changes.
- Specialists may provide semantic intent such as flow direction, ranks, groups, relationships, and concise label suggestions. They must not directly control raw pixel coordinates.
- A deterministic local layout and routing layer must convert semantic intent into a previewable, validated canvas diff. It should prevent overlaps, zero-length or unreadable directional connections, and label clutter, with a local fallback when delegated layout is unavailable.
- “Arrange” and “polish” are reversible canvas proposals. Accepting a canvas arrangement is distinct from promoting a design decision into the durable document; neither acceptance step may happen autonomously.
- Preserve a clear proposal lifecycle: proposed, human-edited, canvas-accepted or rejected, and optionally promoted to the document. Proposal lineage and failure/fallback behavior must remain inspectable.
- Before expanding implementation, maintain an Agent Interaction Contract covering roles, delegation triggers, specialist inputs and outputs, canvas mutation and approval policy, failure behavior, and the future Codex specialist boundary.
- Do not replace freeform human canvas work with a rigid schema or uncontrolled diagram compiler. Do not add arbitrary manual routing as a substitute for semantic organization.
