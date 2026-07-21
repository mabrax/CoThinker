# CoThinker

CoThinker is a shared thinking space where a person and an OpenAI Realtime collaborator discuss, draw on an editable canvas, and explicitly promote accepted work into a design document.

The canvas is shared working material. AI changes are orange, dashed proposals that can be edited or removed. Nothing enters the durable document until the human selects and promotes it.

## Run locally

Prerequisites: Node.js 22 or newer, a Chromium-based browser, and an OpenAI API key available only to the server process.

```powershell
npm install
Copy-Item .env.example .env
# Set OPENAI_API_KEY in .env without committing the file.
npm run dev
```

Open `http://127.0.0.1:5173`. When the key is absent, CoThinker deliberately shows a setup-required state. Manual canvas editing and human document promotion still work; AI conversation, typed messages, and microphone interaction remain unavailable until OpenAI Realtime is connected.

`npm run dev` loads the optional `.env` file into the server process. Process environment values take precedence. The browser never receives the API key.

Confirm setup without revealing credentials:

```powershell
(Invoke-RestMethod http://127.0.0.1:3001/api/health).openaiConfigured
```

## Realtime smoke test

1. Start the server with a valid server-side key and open the app in Chromium.
2. Select **Connect OpenAI Realtime** and allow microphone access.
3. Confirm that both the spoken human turn and assistant response appear in the transcript.
4. Ask for one canvas idea. Confirm it appears as an orange dashed AI proposal.
5. Speak while the assistant is responding and confirm the session returns to listening.
6. Select the proposal, use **Promote selection**, then disconnect. Confirm microphone access ends.

This test consumes API quota. The automated suite instead uses test-only WebRTC/DataChannel fixtures and mocked server-side OpenAI upstream calls.

## Architecture and boundaries

- The browser renders Excalidraw, hosts the WebRTC connection, and applies validated canvas tool requests.
- `server/` owns all OpenAI configuration, model names, voice, instructions, and the API key boundary.
- Realtime tools use shared typed contracts. Tool results truthfully report validation, connection, or upstream errors.
- Workspace state persists the actual serialized canvas scene, transcript, accepted sections, selection, activity trace, and session status locally with a versioned migration path.
- The document grows only from explicit human promotion and retains canvas-source IDs.

See [DESIGN.md](./DESIGN.md) for the interaction model and deliberately excluded scope.

## Verify

```powershell
npm run check
npm run test:e2e
npm run secrets:check
npm run audit:prod
```

`npm run check` runs linting, unit tests, TypeScript, and a production build. The browser suite covers unavailable setup, a mocked Realtime connection, both transcripts, AI canvas proposals, human promotion, interruption, and disconnect cleanup.

## Security

Local credentials belong only in `.env`; the file and other `.env.*` variants are ignored by Git. Never add API keys to browser code, commits, fixtures, screenshots, or test output. `npm run secrets:check` scans repository history with Gitleaks, while CI checks dependency advisories with `npm audit --omit=dev --audit-level=high`.
