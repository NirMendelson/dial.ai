import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

type CameraMode = 'pov' | 'recon' | 'overview'
type Coordinates = [longitude: number, latitude: number]
type TranscriptRole = 'user' | 'agent'
type TranscriptStatus = 'waiting' | 'connected' | 'ended'

type TranscriptState = {
  callId: string | null
  status: TranscriptStatus
  transcript: Array<{ role: TranscriptRole; content: string }>
  agentDraft: string
}

const initialTranscriptState: TranscriptState = {
  callId: null,
  status: 'waiting',
  transcript: [],
  agentDraft: '',
}

const initialWaypoints: Array<{ name: string; coordinates: Coordinates }> = [
  { name: 'Hill', coordinates: [-116.655204, 35.273822] },
  { name: 'Hill 2', coordinates: [-116.650706, 35.268734] },
  { name: 'Hill 3', coordinates: [-116.656009, 35.267672] },
  { name: 'Hill 4', coordinates: [-116.657988, 35.270774] },
]

const cameraSettings: Record<
  CameraMode,
  { zoom: number; pitch: number; bearing: number }
> = {
  pov: { zoom: 17.2, pitch: 70, bearing: 58 },
  recon: { zoom: 18.6, pitch: 0, bearing: 0 },
  overview: { zoom: 15.8, pitch: 42, bearing: -12 },
}

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(5)} ${value >= 0 ? positive : negative}`
}

function getTextDirection(content: string): 'rtl' | 'ltr' {
  return /[\u0590-\u05ff]/.test(content) ? 'rtl' : 'ltr'
}

function TranscriptPanel() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const [state, setState] = useState(initialTranscriptState)
  const [isReconnecting, setIsReconnecting] = useState(false)

  useEffect(() => {
    const source = new EventSource('/api/transcript/stream')

    const handleState = (event: Event) => {
      try {
        const nextState = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as TranscriptState
        setState(nextState)
        setIsReconnecting(false)
      } catch {
        setIsReconnecting(true)
      }
    }

    source.addEventListener('state', handleState)
    source.onopen = () => setIsReconnecting(false)
    source.onerror = () => setIsReconnecting(true)

    return () => {
      source.removeEventListener('state', handleState)
      source.close()
    }
  }, [])

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return

    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [state.agentDraft, state.transcript])

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 80
  }

  const displayStatus = isReconnecting
    ? 'reconnecting'
    : state.status === 'connected'
      ? 'live'
      : state.status

  const hasTranscript = state.transcript.length > 0 || state.agentDraft

  return (
    <aside className="transcript-panel">
      <header className="transcript-header">
        <div>
          <p>Live channel</p>
          <h2>Transcript</h2>
        </div>
        <span className={`transcript-status ${displayStatus}`}>
          <i />
          {displayStatus}
        </span>
      </header>

      <div
        ref={scrollRef}
        className="transcript-scroll"
        onScroll={handleScroll}
      >
        {!hasTranscript && (
          <div className="transcript-empty">
            <span className="empty-line" />
            <p>
              {state.status === 'ended'
                ? 'Call ended without a transcript.'
                : 'Waiting for call activity...'}
            </p>
          </div>
        )}

        <div className="transcript-list" aria-live="polite">
          {state.transcript.map((item, index) => (
            <article
              className={`transcript-entry ${item.role}`}
              key={`${index}-${item.role}-${item.content}`}
            >
              <span>
                {item.role === 'agent' ? 'Drone Agent' : 'Operations'}
              </span>
              <p
                dir={getTextDirection(item.content)}
                lang={getTextDirection(item.content) === 'rtl' ? 'he' : 'en'}
              >
                {item.content}
              </p>
            </article>
          ))}

          {state.agentDraft && (
            <article className="transcript-entry agent draft">
              <span>Drone Agent</span>
              <p
                dir={getTextDirection(state.agentDraft)}
                lang={getTextDirection(state.agentDraft) === 'rtl' ? 'he' : 'en'}
              >
                {state.agentDraft}
                <i className="draft-cursor" />
              </p>
            </article>
          )}
        </div>
      </div>

      <footer className="transcript-footer">
        <span>{state.callId ? 'Connected to Dial' : 'No active call'}</span>
        {state.callId && <code>{state.callId.slice(-10)}</code>}
      </footer>
    </aside>
  )
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const waypointMarkersRef = useRef<mapboxgl.Marker[]>([])
  const [cameraMode, setCameraMode] = useState<CameraMode>('pov')
  const [waypoints, setWaypoints] = useState(initialWaypoints)
  const [waypointIndex, setWaypointIndex] = useState(0)
  const [isMoving, setIsMoving] = useState(false)
  const [groundElevation, setGroundElevation] = useState<number | null>(null)
  const [activeCoordinates, setActiveCoordinates] = useState<Coordinates>(
    initialWaypoints[0].coordinates,
  )
  const [mapCenterCoordinates, setMapCenterCoordinates] =
    useState<Coordinates>(initialWaypoints[0].coordinates)
  const [latitudeInput, setLatitudeInput] = useState(
    String(initialWaypoints[0].coordinates[1]),
  )
  const [longitudeInput, setLongitudeInput] = useState(
    String(initialWaypoints[0].coordinates[0]),
  )
  const [coordinateError, setCoordinateError] = useState('')
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
      style: 'mapbox://styles/mapbox/standard-satellite',
      center: initialWaypoints[0].coordinates,
      ...cameraSettings.pov,
      attributionControl: false,
      antialias: true,
      maxPitch: 85,
    })

    const markerElement = document.createElement('div')
    markerElement.className = 'drone-marker'
    markerElement.innerHTML = '<span></span>'

    const marker = new mapboxgl.Marker({
      element: markerElement,
      rotationAlignment: 'map',
    })
      .setLngLat(initialWaypoints[0].coordinates)
      .addTo(map)

    const waypointMarkers = initialWaypoints.map((waypoint, index) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'waypoint-marker'
      element.setAttribute('aria-label', `Select ${waypoint.name}`)

      const pin = document.createElement('span')
      pin.className = 'waypoint-pin'
      pin.textContent = String(index + 1)

      const label = document.createElement('span')
      label.className = 'waypoint-label'
      label.textContent = waypoint.name
      element.append(pin, label)

      const waypointMarker = new mapboxgl.Marker({
        element,
        anchor: 'bottom',
        altitude: 1.5,
        occludedOpacity: 0,
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
      })
        .setLngLat(waypoint.coordinates)
        .addTo(map)

      element.addEventListener('click', () => {
        const position = waypointMarker.getLngLat()
        const coordinates: Coordinates = [position.lng, position.lat]

        setWaypointIndex(index)
        setActiveCoordinates(coordinates)
        setMapCenterCoordinates(coordinates)
        setLatitudeInput(position.lat.toFixed(6))
        setLongitudeInput(position.lng.toFixed(6))
        setCoordinateError('')
        marker.setLngLat(coordinates)
        map.flyTo({ center: coordinates, duration: 1400, essential: true })
      })

      return waypointMarker
    })

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

      map.addSource('building-footprints', {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v8',
      })

      map.addLayer({
        id: '3d-buildings',
        type: 'fill-extrusion',
        source: 'building-footprints',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['==', ['get', 'extrude'], 'true'],
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'height'], 8],
            0,
            '#2f403a',
            40,
            '#62736c',
            160,
            '#9aaba3',
          ],
          'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            14.4,
            ['coalesce', ['get', 'height'], 8],
          ],
          'fill-extrusion-base': [
            'coalesce',
            ['get', 'min_height'],
            0,
          ],
          'fill-extrusion-opacity': 0.68,
          'fill-extrusion-vertical-gradient': true,
        },
      })

      map.addSource('mission-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: initialWaypoints.map(
              (waypoint) => waypoint.coordinates,
            ),
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

    map.on('idle', () => {
      const elevation = map.queryTerrainElevation(marker.getLngLat(), {
        exaggerated: false,
      })
      if (elevation != null) setGroundElevation(Math.round(elevation))
    })

    map.on('move', () => {
      const center = map.getCenter()
      setMapCenterCoordinates([center.lng, center.lat])
    })

    map.on('moveend', () => {
      const center = map.getCenter()
      setLatitudeInput(center.lat.toFixed(6))
      setLongitudeInput(center.lng.toFixed(6))
      setCoordinateError('')
    })

    mapRef.current = map
    markerRef.current = marker
    waypointMarkersRef.current = waypointMarkers

    return () => {
      waypointMarkers.forEach((waypointMarker) => waypointMarker.remove())
      marker.remove()
      map.remove()
      markerRef.current = null
      waypointMarkersRef.current = []
      mapRef.current = null
    }
  }, [token])

  useEffect(() => {
    waypointMarkersRef.current.forEach((marker, index) => {
      const waypoint = waypoints[index]
      if (!waypoint) return

      marker.setLngLat(waypoint.coordinates)
      marker
        .getElement()
        .classList.toggle('active', index === waypointIndex)
    })

    const route = mapRef.current?.getSource('mission-route') as
      | GeoJSONSource
      | undefined
    route?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: waypoints.map((waypoint) => waypoint.coordinates),
      },
    })
  }, [waypointIndex, waypoints])

  const selectMode = (mode: CameraMode) => {
    setCameraMode(mode)

    if (mode === 'overview' && mapRef.current) {
      const bounds = waypoints.slice(1).reduce(
        (currentBounds, waypoint) =>
          currentBounds.extend(waypoint.coordinates),
        new mapboxgl.LngLatBounds(
          waypoints[0].coordinates,
          waypoints[0].coordinates,
        ),
      )

      mapRef.current.fitBounds(bounds, {
        padding: { top: 120, right: 320, bottom: 140, left: 220 },
        pitch: cameraSettings.overview.pitch,
        bearing: cameraSettings.overview.bearing,
        duration: 1400,
        essential: true,
      })
      return
    }

    updateCamera(mode, activeCoordinates)
  }

  const moveToNextWaypoint = () => {
    const nextIndex = (waypointIndex + 1) % waypoints.length
    const nextWaypoint = waypoints[nextIndex]

    setIsMoving(true)
    setWaypointIndex(nextIndex)
    setActiveCoordinates(nextWaypoint.coordinates)
    setMapCenterCoordinates(nextWaypoint.coordinates)
    setLatitudeInput(String(nextWaypoint.coordinates[1]))
    setLongitudeInput(String(nextWaypoint.coordinates[0]))
    setCoordinateError('')
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

  const applyCoordinates = () => {
    const latitude = Number(latitudeInput)
    const longitude = Number(longitudeInput)

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      setCoordinateError('Enter a valid latitude and longitude')
      return
    }

    const coordinates: Coordinates = [longitude, latitude]
    setCoordinateError('')
    setActiveCoordinates(coordinates)
    setMapCenterCoordinates(coordinates)
    setWaypoints((currentWaypoints) =>
      currentWaypoints.map((waypoint, index) =>
        index === waypointIndex ? { ...waypoint, coordinates } : waypoint,
      ),
    )
    markerRef.current?.setLngLat(coordinates)
    updateCamera(cameraMode, coordinates, 2200)
  }

  return (
    <main className="app-shell">
      <section className="drone-console">
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
            <dd>058 <small>deg</small></dd>
          </div>
          <div>
            <dt>GND</dt>
            <dd>{groundElevation ?? '--'} <small>m ASL</small></dd>
          </div>
        </dl>
      </aside>

      <section className="location-card hud-panel">
        <p className="panel-label">Map center / waypoint</p>
        <strong>{activeWaypoint.name}</strong>
        <span className="formatted-coordinate">
          {formatCoordinate(mapCenterCoordinates[1], 'N', 'S')} /{' '}
          {formatCoordinate(mapCenterCoordinates[0], 'E', 'W')}
        </span>
        <div className="coordinate-fields">
          <label>
            <span>Latitude</span>
            <input
              type="number"
              min="-90"
              max="90"
              step="0.000001"
              value={latitudeInput}
              onChange={(event) => setLatitudeInput(event.target.value)}
            />
          </label>
          <label>
            <span>Longitude</span>
            <input
              type="number"
              min="-180"
              max="180"
              step="0.000001"
              value={longitudeInput}
              onChange={(event) => setLongitudeInput(event.target.value)}
            />
          </label>
        </div>
        {coordinateError && <p className="coordinate-error">{coordinateError}</p>}
        <button type="button" onClick={applyCoordinates} disabled={!token}>
          Apply coordinates
        </button>
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
      </section>

      <TranscriptPanel />
    </main>
  )
}

export default App
