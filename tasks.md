# Hackathon Tasks

## Phase 1 — Setup & Research
- [ ] Read Dial.ai hackathon criteria and scoring rubric
- [ ] Install Dial CLI (`curl -fsSL https://getdial.ai/install | bash`)
- [ ] Set up project repo and folder structure
- [ ] Decide on tech stack (frontend framework, backend language, DB type)

## Phase 2 — Website

### Layout & Shell
- [ ] Build main page layout: 3-panel (videos, transcript, map)
- [ ] Make it look good enough for a recorded demo (dark theme, military feel)

### Video Panel
- [ ] Embed Nir + Noam webcam-style video (can be pre-recorded clips)
- [ ] Embed drone footage video (existing clip)

### Transcript Panel
- [ ] Display scripted transcript line by line with speaker labels
- [ ] Animate lines appearing in real time (synced to script timing)
- [ ] Highlight the line that triggers the agent

### Agent Thinking State
- [ ] Show a visual "Agent is processing..." state when triggered
- [ ] Transition to "Decision: go to [location]" when done

### Map / Drone Visualization
- [ ] 2D or 3D map showing named locations from the DB
- [ ] Animated drone marker moving to target location
- [ ] Show drone's current position and destination

### Location DB Panel (optional)
- [ ] Display the location DB on screen (name, lat, lng)
- [ ] Highlight the target location when the agent picks it

## Phase 3 — Transcriber
- [ ] Write a script-playback module that feeds lines on a timer
- [ ] Detect the trigger phrase/pattern in the transcript
- [ ] Fire the agent with the full conversation context when triggered

## Phase 4 — AI Agent (Drone Mock)
- [ ] Set up Dial.ai agent
- [ ] Write system prompt: role, decision logic, available tools
- [ ] Implement `go_to(location_name)` tool — looks up DB, returns coordinates
- [ ] Implement `calculate_position(reference, direction, distance)` tool
- [ ] Connect agent output back to the website (update map + transcript)

## Phase 5 — Location Database
- [ ] Define schema: `{ name, latitude, longitude, description }`
- [ ] Populate with 5–10 named locations for the demo scenario
- [ ] Choose storage (JSON file, SQLite, or similar — keep it simple)

## Phase 6 — MCP for the DB
- [ ] Write MCP server that exposes the location DB to the agent
- [ ] Tool: `lookup_location(name)` → returns lat/lng
- [ ] Tool: `list_locations()` → returns all named locations
- [ ] Connect MCP server to the Dial agent

## Phase 7 — Demo Script
- [ ] Write the full scenario with speaker lines and timestamps (60s total)
- [ ] Decide exact trigger moment and agent decision
- [ ] Sync script timing to transcript animation and map movement
- [ ] Write 0–10s voiceover (problem statement)
- [ ] Record and edit the final demo video
