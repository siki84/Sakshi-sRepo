"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useCallback, useEffect, useRef } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  color: string;
  /** Dashed outline = approximate location. */
  approximate?: boolean;
  dim?: boolean;
};

function pinIcon(p: MapPoint, selected: boolean) {
  const size = selected ? 34 : 26;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${p.color};color:white;
      display:flex;align-items:center;justify-content:center;font:600 ${selected ? 14 : 12}px system-ui;
      border:2px ${p.approximate ? "dashed" : "solid"} white;box-shadow:0 1px 4px rgba(0,0,0,.35);
      opacity:${p.dim ? 0.45 : 1}">${p.label}</div>`,
  });
}

/**
 * Fit all points in view. Leaflet measures its container once, so also re-measure (and
 * refit if it was hidden) whenever the container resizes — e.g. the mobile List/Map toggle.
 */
function FitBounds({ points, padding }: { points: MapPoint[]; padding: number }) {
  const map = useMap();
  const key = points.map((p) => p.id).join(",");
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  });

  const fit = useCallback(() => {
    const pts = pointsRef.current;
    const el = map.getContainer();
    if (!pts.length || el.clientWidth === 0 || el.clientHeight === 0) return;
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [padding, padding],
      maxZoom: 15,
    });
  }, [map, padding]);

  // Refit when the set of points changes.
  useEffect(() => {
    fit();
  }, [key, fit]);

  // Refit when a hidden map becomes visible; otherwise just re-measure.
  useEffect(() => {
    const el = map.getContainer();
    let wasHidden = el.clientWidth === 0 || el.clientHeight === 0;
    const ro = new ResizeObserver(() => {
      const hidden = el.clientWidth === 0 || el.clientHeight === 0;
      if (wasHidden && !hidden) fit();
      else if (!hidden) map.invalidateSize();
      wasHidden = hidden;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, fit]);
  return null;
}

function FlyTo({ point }: { point: MapPoint | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.panTo([point.lat, point.lng], { animate: true });
  }, [point, map]);
  return null;
}

export default function MapView({
  points,
  center,
  selectedId,
  onSelect,
  route,
  className = "h-80",
}: {
  points: MapPoint[];
  center: { lat: number; lng: number };
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Optional line connecting points in order (day routes). */
  route?: { lat: number; lng: number }[];
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-xl ring-1 ring-slate-200 ${className}`} data-testid="map">
      <MapContainer center={[center.lat, center.lng]} zoom={12} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {route && route.length > 1 && (
          <Polyline positions={route.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#0f172a", weight: 3, opacity: 0.6, dashArray: "6 6" }} />
        )}
        {points.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={pinIcon(p, p.id === selectedId)}
            zIndexOffset={p.id === selectedId ? 1000 : 0}
            eventHandlers={{ click: () => onSelect?.(p.id) }}
          >
            <Tooltip>{p.title}</Tooltip>
          </Marker>
        ))}
        <FitBounds points={points} padding={30} />
        <FlyTo point={points.find((p) => p.id === selectedId)} />
      </MapContainer>
    </div>
  );
}
