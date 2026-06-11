# Drone POV frontend

React + Vite interface for the Dial autonomous drone demo. It uses Mapbox GL JS for satellite imagery, terrain, camera movement, and mission waypoints.

## Run

```bash
npm install
cp .env.example .env
```

Add a public Mapbox token to `.env`:

```env
VITE_MAPBOX_ACCESS_TOKEN=pk.your_public_mapbox_token
```

Then start the app:

```bash
npm run dev
```

Open `http://localhost:5173`. Use the camera mode buttons to switch between POV, top-down recon, and overview. **Move to next waypoint** demonstrates smooth drone navigation between fixed Tel Aviv locations.
