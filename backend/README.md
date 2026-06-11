# Dial drone backend

Minimal Hono server based on Dial's self-hosted OpenAI Node playbook.

## Setup

```bash
cd ..
nvm use
cd backend
npm install
cp .env.example .env
```

`better-sqlite3` is a native dependency. If you change Node versions after
installing dependencies, run `npm rebuild better-sqlite3` before starting the
backend.

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

## Wake name

The agent stays silent unless the latest caller turn contains `ברק 1`. Dial still
receives an empty completed response for unaddressed turns so the call can
continue normally. Set a different wake name with:

```env
AGENT_WAKE_NAME=ברק 1
```

Each command must include the wake name. Detection tolerates punctuation and
spacing such as `ברק-1`, while avoiding partial numeric matches such as
`ברק 10`.

## Location MCP tools

The backend starts a local stdio MCP server and exposes its discovered tools to
the OpenAI model. Locations are stored in SQLite at `data/locations.db` by
default. Override the path with:

```env
LOCATION_DB_PATH=/absolute/path/to/locations.db
```

Tool calls and results are published with the transcript state at
`/api/transcript/stream`. The MCP server provides `list_locations`,
`lookup_location`, `calculate_position`, and `go_to`.
