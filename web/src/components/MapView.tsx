import { useEffect, useRef } from 'react';
import {
  GeolocateControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type MapMouseEvent,
} from 'maplibre-gl';
import type { BoundingBox, Report, ResourceStatus } from '@derf/shared';
import { DEFAULT_VIEW } from '../lib/config';

/**
 * Derived from the Map constructor rather than imported: maplibre-gl v6 does not
 * re-export StyleSpecification (it lives in the style-spec package), and this
 * cannot drift out of step with the installed version.
 */
type MapStyle = NonNullable<ConstructorParameters<typeof MapLibreMap>[0]['style']>;

/**
 * Raster tiles straight from OpenStreetMap.
 *
 * No account or API key, unlike Mapbox. OSM's tile usage policy is aimed at
 * light traffic, which a coursework demo comfortably is — but it would need
 * replacing with a hosted tile provider before any real deployment.
 */
const OSM_STYLE: MapStyle = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Status drives marker colour — availability is the thing being scanned for. */
const STATUS_COLOUR: Record<ResourceStatus, string> = {
  available: '#1a7f5a',
  limited: '#b9770e',
  unavailable: '#b03a2e',
  unknown: '#5d6d7e',
};

interface MapViewProps {
  reports: Report[];
  onBoundsChange: (bbox: BoundingBox) => void;
  /** Called when the user picks a spot to report on. */
  onPickLocation: (lat: number, lon: number) => void;
  picking: boolean;
}

export function MapView({
  reports,
  onBoundsChange,
  onPickLocation,
  picking,
}: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);

  // Keep the latest callbacks in refs so the map is created once and never
  // torn down by a re-render.
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onPickLocationRef = useRef(onPickLocation);
  const pickingRef = useRef(picking);
  onBoundsChangeRef.current = onBoundsChange;
  onPickLocationRef.current = onPickLocation;
  pickingRef.current = picking;

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: OSM_STYLE,
      center: [DEFAULT_VIEW.lon, DEFAULT_VIEW.lat],
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: { compact: true },
    });

    instance.addControl(new NavigationControl(), 'top-right');
    instance.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right');

    const publishBounds = () => {
      const b = instance.getBounds();
      onBoundsChangeRef.current({
        minLon: b.getWest(),
        minLat: b.getSouth(),
        maxLon: b.getEast(),
        maxLat: b.getNorth(),
      });
    };

    instance.on('load', publishBounds);
    // moveend, not move: one request when panning stops, rather than one per frame.
    instance.on('moveend', publishBounds);

    instance.on('click', (event: MapMouseEvent) => {
      if (!pickingRef.current) return;
      onPickLocationRef.current(event.lngLat.lat, event.lngLat.lng);
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Cursor signals that clicking the map will do something.
  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = picking ? 'crosshair' : '';
  }, [picking]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    markers.current.forEach((marker) => marker.remove());
    markers.current = reports.map((report) => {
      const popup = new Popup({ offset: 24 }).setHTML(renderPopup(report));
      return new Marker({ color: STATUS_COLOUR[report.status] })
        .setLngLat([report.location.lon, report.location.lat])
        .setPopup(popup)
        .addTo(instance);
    });
  }, [reports]);

  return <div className="map" ref={container} />;
}

/** Escapes user-submitted text before it goes into popup HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPopup(report: Report): string {
  const age = timeAgo(report.reportedAt);
  const capacity = report.capacity
    ? `<div class="popup-row">Capacity ${report.capacity.current} of ${report.capacity.maximum}</div>`
    : '';
  const note = report.note
    ? `<div class="popup-note">${escapeHtml(report.note)}</div>`
    : '';

  return `
    <div class="popup">
      <div class="popup-head">
        <strong>${escapeHtml(report.resourceType)}</strong>
        <span class="popup-status popup-${report.status}">${report.status}</span>
      </div>
      ${capacity}
      ${note}
      <div class="popup-meta">Reported ${age}</div>
    </div>`;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
