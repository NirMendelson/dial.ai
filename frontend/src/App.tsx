import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import './App.css'

type CameraMode = 'pov' | 'recon' | 'overview'
type Coordinates = [longitude: number, latitude: number]
type TranscriptRole = 'user' | 'agent'
type TranscriptStatus = 'waiting' | 'connected' | 'ended'

type LocationRecord = {
  name: string
  latitude: number
  longitude: number
  description: string
}

type StatusActivity = {
  id: string
  type: 'status'
  phase: 'processing' | 'responding'
  status: 'running' | 'completed' | 'cancelled'
  timestamp: string
  transcriptIndex: number
}

type ToolActivity = {
  id: string
  type: 'tool'
  name: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  input: unknown
  output?: unknown
  error?: string
  startedAt: string
  finishedAt?: string
  transcriptIndex: number
}

type AgentActivity = StatusActivity | ToolActivity

type TranscriptState = {
  callId: string | null
  status: TranscriptStatus
  transcript: Array<{ role: TranscriptRole; content: string }>
  agentDraft: string
  activities: AgentActivity[]
  locations: LocationRecord[]
}

const initialTranscriptState: TranscriptState = {
  callId: null,
  status: 'waiting',
  transcript: [],
  agentDraft: '',
  activities: [],
  locations: [],
}

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

function TranscriptPanel({
  state,
  isReconnecting,
}: {
  state: TranscriptState
  isReconnecting: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return

    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [state.activities, state.agentDraft, state.transcript])

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

  const hasTranscript =
    state.transcript.length > 0 || state.activities.length > 0 || state.agentDraft

  const renderActivities = (transcriptIndex: number) =>
    state.activities
      .filter((activity) => activity.transcriptIndex === transcriptIndex)
      .map((activity) =>
        activity.type === 'status' ? (
          <article
            className={`transcript-activity status ${activity.status}`}
            key={activity.id}
          >
            <i />
            <span>Agent {activity.phase}</span>
            <b>{activity.status}</b>
          </article>
        ) : (
          <article
            className={`transcript-activity tool ${activity.status}`}
            key={activity.id}
          >
            <i>&gt;_</i>
            <div>
              <span>Agent tool</span>
              <strong>{activity.name}</strong>
            </div>
            <b>{activity.status}</b>
          </article>
        ),
      )

  return (
    <section className="transcript-panel">
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
            <div className="transcript-turn" key={`${index}-${item.role}-${item.content}`}>
              {renderActivities(index)}
              <article className={`transcript-entry ${item.role}`}>
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
            </div>
          ))}

          {renderActivities(state.transcript.length)}

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
    </section>
  )
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const waypointMarkersRef = useRef<mapboxgl.Marker[]>([])
  const navigationFrameRef = useRef<number | null>(null)
  const processedActivityIdsRef = useRef(new Set<string>())
  const processedCallIdRef = useRef<string | null>(null)
  const activeCoordinatesRef = useRef<Coordinates | null>(null)
  const cameraModeRef = useRef<CameraMode>('pov')
  const [state, setState] = useState(initialTranscriptState)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('pov')
  const [waypoints, setWaypoints] = useState<
    Array<{ name: string; coordinates: Coordinates }>
  >([])
  const [waypointIndex, setWaypointIndex] = useState(0)
  const [isMoving, setIsMoving] = useState(false)
  const [missionTarget, setMissionTarget] = useState<{
    name: string
    coordinates: Coordinates
  } | null>(null)
  const [groundElevation, setGroundElevation] = useState<number | null>(null)
  const [activeCoordinates, setActiveCoordinates] =
    useState<Coordinates | null>(null)
  const [mapCenterCoordinates, setMapCenterCoordinates] =
    useState<Coordinates | null>(null)
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
  const activeWaypoint = waypoints[waypointIndex]
  let highlightedLocationName: string | null = null

  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const activity = state.activities[index]
    if (
      activity.type === 'tool' &&
      activity.name === 'lookup_location' &&
      activity.status === 'succeeded' &&
      typeof activity.output === 'object' &&
      activity.output !== null &&
      'location' in activity.output
    ) {
      const location = activity.output.location
      if (
        typeof location === 'object' &&
        location !== null &&
        'name' in location &&
        typeof location.name === 'string'
      ) {
        highlightedLocationName = location.name
      }
      break
    }
  }

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
    activeCoordinatesRef.current = activeCoordinates
  }, [activeCoordinates])

  useEffect(() => {
    cameraModeRef.current = cameraMode
  }, [cameraMode])

  const navigateToCoordinates = useCallback(
    (coordinates: Coordinates, label: string, duration = 3200) => {
      const marker = markerRef.current
      const current = marker?.getLngLat()
      const start: Coordinates = current
        ? [current.lng, current.lat]
        : activeCoordinatesRef.current || coordinates

      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current)
      }

      setIsMoving(true)
      setMissionTarget({ name: label, coordinates })
      setActiveCoordinates(coordinates)
      setMapCenterCoordinates(coordinates)
      updateCamera(cameraModeRef.current, coordinates, duration)

      const route = mapRef.current?.getSource('mission-route') as
        | GeoJSONSource
        | undefined
      route?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [start, coordinates] },
      })

      if (!marker) {
        setIsMoving(false)
        return
      }

      const startedAt = performance.now()
      const animate = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        marker.setLngLat([
          start[0] + (coordinates[0] - start[0]) * eased,
          start[1] + (coordinates[1] - start[1]) * eased,
        ])

        if (progress < 1) {
          navigationFrameRef.current = window.requestAnimationFrame(animate)
        } else {
          navigationFrameRef.current = null
          setIsMoving(false)
        }
      }
      navigationFrameRef.current = window.requestAnimationFrame(animate)
    },
    [updateCamera],
  )

  useEffect(() => {
    const source = new EventSource('/api/transcript/stream')

    const handleState = (event: Event) => {
      try {
        const nextState = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as TranscriptState
        setState(nextState)
        setIsReconnecting(false)

        if (processedCallIdRef.current !== nextState.callId) {
          processedCallIdRef.current = nextState.callId
          processedActivityIdsRef.current.clear()
        }

        if (nextState.locations.length > 0) {
          const nextWaypoints = nextState.locations.map((location) => ({
            name: location.name,
            coordinates: [location.longitude, location.latitude] as Coordinates,
          }))
          setWaypoints((currentWaypoints) => {
            const unchanged =
              currentWaypoints.length === nextWaypoints.length &&
              currentWaypoints.every(
                (waypoint, index) =>
                  waypoint.name === nextWaypoints[index].name &&
                  waypoint.coordinates[0] ===
                    nextWaypoints[index].coordinates[0] &&
                  waypoint.coordinates[1] ===
                    nextWaypoints[index].coordinates[1],
              )
            return unchanged ? currentWaypoints : nextWaypoints
          })

          if (!activeCoordinatesRef.current) {
            const firstCoordinates = nextWaypoints[0]?.coordinates
            if (firstCoordinates) {
              activeCoordinatesRef.current = firstCoordinates
              setActiveCoordinates(firstCoordinates)
              setMapCenterCoordinates(firstCoordinates)
            }
          }
        }

        for (const activity of nextState.activities) {
          if (
            activity.type !== 'tool' ||
            activity.name !== 'go_to' ||
            activity.status === 'running' ||
            processedActivityIdsRef.current.has(activity.id)
          ) {
            continue
          }

          processedActivityIdsRef.current.add(activity.id)
          if (
            activity.status !== 'succeeded' ||
            typeof activity.output !== 'object' ||
            activity.output === null
          ) {
            continue
          }

          const output = activity.output as {
            accepted?: unknown
            latitude?: unknown
            longitude?: unknown
            label?: unknown
          }
          if (
            output.accepted !== true ||
            typeof output.latitude !== 'number' ||
            typeof output.longitude !== 'number' ||
            output.latitude < -90 ||
            output.latitude > 90 ||
            output.longitude < -180 ||
            output.longitude > 180
          ) {
            continue
          }

          navigateToCoordinates(
            [output.longitude, output.latitude],
            typeof output.label === 'string'
              ? output.label
              : 'Agent destination',
          )
        }
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
  }, [navigateToCoordinates])

  useEffect(() => {
    if (
      !token ||
      !containerRef.current ||
      mapRef.current ||
      waypoints.length === 0
    ) {
      return
    }

    const initialCoordinates = waypoints[0].coordinates

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard-satellite',
      center: initialCoordinates,
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
      .setLngLat(initialCoordinates)
      .addTo(map)

    const waypointMarkers = waypoints.map((waypoint, index) => {
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

    mapRef.current = map
    markerRef.current = marker
    waypointMarkersRef.current = waypointMarkers

    return () => {
      if (navigationFrameRef.current !== null) {
        window.cancelAnimationFrame(navigationFrameRef.current)
        navigationFrameRef.current = null
      }
      waypointMarkers.forEach((waypointMarker) => waypointMarker.remove())
      marker.remove()
      map.remove()
      markerRef.current = null
      waypointMarkersRef.current = []
      mapRef.current = null
    }
  }, [token, waypoints])

  useEffect(() => {
    waypointMarkersRef.current.forEach((marker, index) => {
      const waypoint = waypoints[index]
      if (!waypoint) return

      marker.setLngLat(waypoint.coordinates)
      const element = marker.getElement()
      element.classList.toggle('active', index === waypointIndex)
      element.classList.toggle('lookup', waypoint.name === highlightedLocationName)
      const label = element.querySelector('.waypoint-label')
      if (label) label.textContent = waypoint.name
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
  }, [highlightedLocationName, waypointIndex, waypoints])

  const selectMode = (mode: CameraMode) => {
    setCameraMode(mode)

    if (!activeCoordinates || waypoints.length === 0) return

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
    if (waypoints.length === 0) return
    const nextIndex = (waypointIndex + 1) % waypoints.length
    const nextWaypoint = waypoints[nextIndex]

    setWaypointIndex(nextIndex)
    navigateToCoordinates(nextWaypoint.coordinates, nextWaypoint.name)
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
        <strong>{missionTarget?.name || activeWaypoint?.name || 'Loading locations'}</strong>
        <span className="formatted-coordinate">
          {mapCenterCoordinates
            ? `${formatCoordinate(mapCenterCoordinates[1], 'N', 'S')} / ${formatCoordinate(mapCenterCoordinates[0], 'E', 'W')}`
            : '--'}
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
          disabled={!token || isMoving || waypoints.length === 0}
        >
          <span>{isMoving ? 'Navigating' : 'Move to next waypoint'}</span>
          <b>{isMoving ? '...' : '>'}</b>
        </button>
      </footer>
      </section>

      <TranscriptPanel state={state} isReconnecting={isReconnecting} />
    </main>
  )
}

export default App
