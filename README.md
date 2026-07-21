# CoThinker POC

CoThinker is an independent proof of concept for human–AI co-working through an interruptible voice conversation, a shared spatial canvas, and an incremental design document.

The canvas is the living working memory. The document contains only ideas that have been explicitly accepted or promoted. AI canvas changes remain visible, editable, undoable, and traceable to document sections.

See [DESIGN.md](./DESIGN.md) for the product hypothesis, selected architecture, scope, and experiment plan.

## Run locally

Prerequisites: Node.js 22 or newer and a Chromium-based browser.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

The POC works without credentials:

- **Tap to speak** uses the browser's speech recognition and speech synthesis.
- **Run autonomous demo** proves the complete conversation → canvas → accepted-document loop.
- The text box accepts deterministic local commands such as `Add an archivist agent`, `Connect X to Y`, and `Promote this to the document`.

To enable the OpenAI Realtime path, copy `.env.example` to `.env`, add a server-side `OPENAI_API_KEY`, and restart the app. The key is never sent to browser code.

```powershell
Copy-Item .env.example .env
npm run dev
```

`npm run dev` loads the optional `.env` file into the server process. Values already set in the process environment take precedence, which keeps deployment-injected configuration authoritative. The app remains in credential-free local mode when `.env` is absent or the key is empty.

Confirm the server recognized the key without exposing it:

```powershell
(Invoke-RestMethod http://127.0.0.1:3001/api/health).openaiConfigured
```

The result should be `True`.

## Live Realtime smoke test

1. Open `http://127.0.0.1:5173` in a Chromium-based browser.
2. Select **Connect OpenAI Realtime** and allow microphone access.
3. Confirm the status changes to **Live with OpenAI**.
4. Speak once and confirm both sides of the conversation appear in the transcript.
5. Ask, “Add a canvas node named Live connection verified.” Confirm the new node appears with the removable AI-proposal style.
6. Speak while the assistant is responding. Confirm playback stops and the status returns to listening.
7. Select **Disconnect live AI** and confirm the browser stops using the microphone.

This manual test creates a real OpenAI session and consumes API quota. The automated suite uses mocked upstream responses and never sends the configured key to OpenAI.

## What is implemented

- Embedded Excalidraw with normal drawing, editing, movement, selection, undo, and export behavior.
- Structured scene access; the collaborator reads element IDs, labels, positions, connections, origin, and selection without relying on screenshots.
- Distinct human and AI provenance. AI proposals use an orange dashed visual language and can be removed independently.
- Local browser speech as a credential-free fallback.
- OpenAI Realtime over WebRTC using `gpt-realtime-2.1`, semantic voice activity detection, interruption, transcription, and function tools.
- A deeper reasoning delegate using the Responses API and `gpt-5.6-sol` for work that should not block the realtime conversational loop.
- Incremental promotion of selected canvas elements into Markdown sections with stable canvas-source IDs.
- Local persistence of transcript and accepted sections.
- Friendly server responses when OpenAI credentials are absent.

The Realtime implementation follows OpenAI's official guidance for [WebRTC browser connections](https://developers.openai.com/api/docs/guides/realtime-webrtc), [voice agents](https://developers.openai.com/api/docs/guides/voice-agents), and [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).

## Verify

```powershell
npm run check
npm run test:e2e
```

`npm run check` runs lint, four unit tests, TypeScript, and a production build. The browser suite exercises the full local story and the unconfigured OpenAI API boundaries.

## Current boundary

This is an experiment, not a production collaboration service. It deliberately omits accounts, remote persistence, multi-user synchronization, mobile packaging, and production observability. A real OpenAI voice session requires a valid API key and microphone permission. Freehand interpretation and pasted images are future vision-input work; structured Excalidraw scene data is the primary source in this POC.
