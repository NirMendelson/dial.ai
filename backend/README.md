# Dial drone backend

Minimal Hono server based on Dial's self-hosted OpenAI Node playbook.

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` and `DIAL_SIGNING_SECRET` in `.env`, then run:

```bash
npm run dev
```

The server listens on `http://localhost:8080` by default. Verify it with:

```bash
curl http://localhost:8080/health
```

Expose port `8080` with a tunnel and configure Dial Self-Hosted with its `wss://` URL. Dial connects to `/<call_id>`, and the server verifies `X-Dial-Signature` before accepting the WebSocket.

The OpenAI stream is cancelled when a newer caller turn arrives, so the agent does not continue speaking over an interruption.
