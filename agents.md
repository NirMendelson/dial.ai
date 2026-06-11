# Dial.ai Hackathon — Autonomous Drone Agent

## Goal

An AI agent that listens to a military/security team conference call, understands the conversation in real time, and autonomously commands a drone based on what is said.

## Components

### 1. Website (Demo UI)
- Live video feeds: Nir, Noam, and the drone camera
- Real-time transcript with speaker labels
- Drone visualization (2D/3D map showing drone position and movement)

### 2. Transcriber + Trigger
- Listens to the conference call audio
- Produces a live transcript with speaker attribution
- When the agent is addressed or a command is detected, triggers the agent with the full conversation context

### 3. Drone Agent (Dial.ai)
- Receives the full conversation transcript
- Decides what action to take
- Has a location database: named places → (latitude, longitude)
- Tools available:
  - `go_to(location_name)` — navigate the drone to a named location
  - `calculate_position(reference, direction, distance)` — resolve relative directions (e.g. "100m north of base") to coordinates
  - Additional tools as needed (hover, scan, return home, etc.)

## How to Connect to the Dial.ai Skill

Install the Dial CLI:

```bash
curl -fsSL https://getdial.ai/install | bash
```

Docs: https://docs.getdial.ai/documentation/get-started/introduction

## Flow

```
Conference call audio
        ↓
  Transcriber (speech-to-text + speaker diarization)
        ↓
  Trigger detected → send full transcript to Dial agent
        ↓
  Agent reasons over conversation → selects tool
        ↓
  Drone executes command
        ↓
  Website updates in real time (transcript + drone position)
```
