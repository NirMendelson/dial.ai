import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

type CameraMode = 'pov' | 'recon' | 'overview'
type Coordinates = [longitude: number, latitude: number]

const waypoints: Array<{ name: string; coordinates: Coordinates }> = [
  { name: 'Begin Base', coordinates: [34.79182, 32.0722] },
  { name: 'Azrieli Perimeter', coordinates: [34.7899, 32.0742] },
  { name: 'Sarona Sector', coordinates: [34.7867, 32.0711] },
]

const cameraSettings: Record<
  CameraMode,
  { zoom: number; pitch: number; bearing: number }
> = {
  pov: { zoom: 18.2, pitch: 72, bearing: 24 },
  recon: { zoom: 18.6, pitch: 0, bearing: 0 },
  overview: { zoom: 15.8, pitch: 42, bearing: -12 },
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const [cameraMode, setCameraMode] = useState<CameraMode>('pov')
  const [waypointIndex, setWaypointIndex] = useState(0)
  const [isMoving, setIsMoving] = useState(false)
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
  const activeWaypoint = waypoints[waypointIndex]

  const updateCamera = useCallback(
    (mode: CameraMode, coordinates: Coordinates, duration = 1400) => {
      const map = mapRef.current
      if (!map) return

      map.flyTo({
        center: coordinates,
        ...cameraSettings[mode],
        duration,
        essential: true,
      })
    },
    [],
  )

  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: waypoints[0].coordinates,
      ...cameraSettings.pov,
      attributionControl: false,
      antialias: true,
    })

    const markerElement = document.createElement('div')
    markerElement.className = 'drone-marker'
    markerElement.innerHTML = '<span></span>'

    const marker = new mapboxgl.Marker({
      element: markerElement,
      rotationAlignment: 'map',
    })
      .setLngLat(waypoints[0].coordinates)
      .addTo(map)

    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    map.on('load', () => {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
      map.setFog({ color: '#081411', 'horizon-blend': 0.12 })

      map.addSource('mission-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: waypoints.map((waypoint) => waypoint.coordinates),
          },
        },
      })

      map.addLayer({
        id: 'mission-route-glow',
        type: 'line',
        source: 'mission-route',
        paint: {
          'line-color': '#8cffbf',
          'line-width': 7,
          'line-opacity': 0.18,
          'line-blur': 5,
        },
      })

      map.addLayer({
        id: 'mission-route-line',
        type: 'line',
        source: 'mission-route',
        paint: {
          'line-color': '#b9ffd7',
          'line-width': 2,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2],
        },
      })
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      marker.remove()
      map.remove()
      markerRef.current = null
      mapRef.current = null
    }
  }, [token])

  const selectMode = (mode: CameraMode) => {
    setCameraMode(mode)
    updateCamera(mode, activeWaypoint.coordinates)
  }

  const moveToNextWaypoint = () => {
    const nextIndex = (waypointIndex + 1) % waypoints.length
    const nextWaypoint = waypoints[nextIndex]

    setIsMoving(true)
    setWaypointIndex(nextIndex)
    markerRef.current?.setLngLat(nextWaypoint.coordinates)
    updateCamera(cameraMode, nextWaypoint.coordinates, 3200)

    const route = mapRef.current?.getSource('mission-route') as
      | GeoJSONSource
      | undefined
    route?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [activeWaypoint.coordinates, nextWaypoint.coordinates],
      },
    })

    window.setTimeout(() => setIsMoving(false), 3200)
  }

  return (
    <main className="drone-console">
      <div ref={containerRef} className="map-canvas" />

      {!token && (
        <section className="token-panel">
          <p className="eyebrow">Map connection required</p>
          <h1>Add your Mapbox token</h1>
          <p>
            Create <code>frontend/.env</code> and restart the dev server.
          </p>
          <pre>VITE_MAPBOX_ACCESS_TOKEN=pk.your_public_token</pre>
        </section>
      )}

      <div className="map-shade" />
      <div className="scan-lines" />

      <header className="top-bar hud-panel">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <strong>DIAL AERIAL</strong>
            <span>Autonomous response unit</span>
          </div>
        </div>

        <div className="mission-status">
          <span className="status-dot" />
          <div>
            <span>Mission status</span>
            <strong>{isMoving ? 'IN TRANSIT' : 'HOLDING POSITION'}</strong>
          </div>
        </div>

        <div className="clock">
          <span>UNIT</span>
          <strong>DRN-01</strong>
        </div>
      </header>

      <aside className="telemetry hud-panel">
        <p className="panel-label">Flight telemetry</p>
        <dl>
          <div>
            <dt>ALT</dt>
            <dd>124 <small>m</small></dd>
          </div>
          <div>
            <dt>SPD</dt>
            <dd>{isMoving ? '42' : '00'} <small>km/h</small></dd>
          </div>
          <div>
            <dt>HDG</dt>
            <dd>024 <small>deg</small></dd>
          </div>
          <div>
            <dt>SIGNAL</dt>
            <dd>98 <small>%</small></dd>
          </div>
        </dl>
      </aside>

      <section className="location-card hud-panel">
        <p className="panel-label">Active waypoint</p>
        <strong>{activeWaypoint.name}</strong>
        <span>
          {activeWaypoint.coordinates[1].toFixed(5)} N /{' '}
          {activeWaypoint.coordinates[0].toFixed(5)} E
        </span>
      </section>

      <div className="reticle" aria-hidden="true">
        <i className="reticle-ring" />
        <i className="reticle-cross horizontal" />
        <i className="reticle-cross vertical" />
        <span>OPTICAL LOCK</span>
      </div>

      <footer className="command-deck hud-panel">
        <div className="camera-modes" aria-label="Camera mode">
          {(['pov', 'recon', 'overview'] as CameraMode[]).map((mode) => (
            <button
              key={mode}
              className={cameraMode === mode ? 'active' : ''}
              onClick={() => selectMode(mode)}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          className="move-command"
          type="button"
          onClick={moveToNextWaypoint}
          disabled={!token || isMoving}
        >
          <span>{isMoving ? 'Navigating' : 'Move to next waypoint'}</span>
          <b>{isMoving ? '...' : '>'}</b>
        </button>
      </footer>
    </main>
  )
}

export default App
