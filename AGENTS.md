# CoThinker project guidance

CoThinker is an experimental shared thinking space: a person and an AI discuss, draw on a shared canvas, and progressively turn accepted ideas into a design document. It is intentionally domain-general, not software-only.

## Working rules

- Keep browser voice interaction conversational and responsive; deeper reasoning should not block the live exchange.
- Treat the canvas as shared working material. AI-generated material should remain visually distinguishable and removable until accepted.
- Preserve the distinction between a proposal and a human-accepted design decision.
- Keep OpenAI credentials server-side. Do not put API keys in browser code, commits, fixtures, or screenshots.
- Run `npm run check` after code changes. Run `npm run test:e2e` for user-flow changes when practical.
- Do not commit generated folders such as `node_modules`, `dist`, or `test-results`.
