import React, { useMemo, useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { Gauge, Clock, AlertCircle, Navigation } from "lucide-react";

function MapFlyTo({ selectedTrain }) {
  const map = useMap();
  useEffect(() => {
    if (selectedTrain?.coordinates?.lat && selectedTrain?.coordinates?.lng) {
      map.flyTo([selectedTrain.coordinates.lat, selectedTrain.coordinates.lng], Math.max(map.getZoom(), 7), {
        duration: 0.8,
      });
    }
  }, [selectedTrain, map]);
  return null;
}

// Fix Leaflet's default marker asset URLs
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Create custom animated SVG icons for trains with directional bearing indicator
const createTrainIcon = (type, isDelayed, isSelected, bearing = 0) => {
  let color = "#06b6d4"; // default cyan for MEMU Passenger
  if (type === "Suburban EMU") color = "#8b5cf6";
  else if (type === "Ordinary Passenger") color = "#10b981";
  else if (isDelayed) color = "#f97316";

  const borderColor = isSelected ? "#ffffff" : color;
  const size = isSelected ? 38 : 32;

  return L.divIcon({
    className: "custom-train-marker",
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: radial-gradient(circle, ${color} 30%, #090e1a 90%);
        border: 2px solid ${borderColor};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 ${isSelected ? "18px #06b6d4" : "10px " + color};
        cursor: pointer;
        position: relative;
        transition: transform 0.3s ease;
      ">
        <!-- Directional Pointer Arrow based on bearing -->
        <div style="
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          transform: rotate(${bearing}deg);
          pointer-events: none;
        ">
          <div style="
            position: absolute;
            top: -5px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-left: 4px solid transparent;
            border-right: 4px solid transparent;
            border-bottom: 6px solid ${borderColor};
          "></div>
        </div>

        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect width="16" height="16" x="4" y="3" rx="2"></rect>
          <path d="M4 11h16"></path>
          <path d="M12 3v8"></path>
          <path d="m8 19-2 3"></path>
          <path d="m16 19 2 3"></path>
          <circle cx="8" cy="15" r="1" fill="white"></circle>
          <circle cx="16" cy="15" r="1" fill="white"></circle>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

export default function RailMap({ trains = [], stations = [], selectedTrain, onSelectTrain }) {
  // Center map around Delhi-Kanpur corridor
  const defaultCenter = [27.8, 78.4];

  // Keyless tile provider mode: 'osm_dark' (OpenStreetMap with CSS dark filter) or 'carto_dark' (CARTO Dark Matter public proxy)
  const [tileProvider, setTileProvider] = useState("osm_dark");

  // Corridor line geometry
  const corridorLine = [
    [28.6415, 77.2194], // NDLS
    [28.6538, 77.4330], // GZB
    [27.8924, 78.0772], // ALJN
    [27.2064, 78.2393], // TDL
    [26.4547, 80.3507], // CNB
    [25.4484, 81.8333], // PRYJ
  ];

  const southernBranch = [
    [27.2064, 78.2393], // TDL
    [27.1592, 77.9942], // AGC
    [26.2166, 78.1906], // GWL
    [25.4484, 78.5685], // VGLJ
    [23.2673, 77.4126], // BPL
  ];

  const andhraBranch = [
    [23.2673, 77.4126], // BPL
    [16.5193, 80.6231], // BZA
    [16.2997, 80.4573], // GNT
  ];

  const coastalAndhraBranch = [
    [16.2997, 80.4573], // GNT (Guntur)
    [16.5193, 80.6231], // BZA (Vijayawada)
    [16.9891, 81.7770], // RJY (Rajahmundry)
    [17.7215, 83.2870], // VSKP (Visakhapatnam)
  ];

  return (
    <div className="relative w-full h-full min-h-[480px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      {/* Map Control HUD Overlay */}
      <div className="absolute top-3 left-3 z-[1000] bg-slate-950/85 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
          <span className="text-slate-300">MEMU Passenger</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
          <span className="text-slate-300">Suburban EMU</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
          <span className="text-slate-300">Ordinary Passenger</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
          <span className="text-slate-300">Delayed &gt; 15m</span>
        </div>
      </div>

      {/* Tile Provider Switcher (Keyless & Demo Safe) */}
      <div className="absolute top-3 right-3 z-[1000] bg-slate-950/85 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-800 flex items-center gap-1.5 text-xs shadow-lg">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">Tiles:</span>
        <button
          onClick={() => setTileProvider("osm_dark")}
          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
            tileProvider === "osm_dark"
              ? "bg-cyan-500 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
          title="OpenStreetMap tiles with dark CSS filter (100% Free, No Key Ever)"
        >
          OSM Dark (Keyless)
        </button>
        <button
          onClick={() => setTileProvider("carto_dark")}
          className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
            tileProvider === "carto_dark"
              ? "bg-cyan-500 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
          title="CARTO Dark Matter free public proxy"
        >
          CARTO Dark
        </button>
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={7}
        scrollWheelZoom={true}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <MapFlyTo selectedTrain={selectedTrain} />

        {/* Keyless Dark Tile Layer (No API Key or Signup Required) */}
        {tileProvider === "osm_dark" ? (
          <TileLayer
            key="osm_dark"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="map-tiles-dark"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="carto_dark"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png"
            subdomains="abcd"
            maxZoom={19}
          />
        )}

        {/* Railway Mainline Corridors */}
        <Polyline
          positions={corridorLine}
          pathOptions={{ color: "#38bdf8", weight: 3, opacity: 0.7, dashArray: "6, 6" }}
        />
        <Polyline
          positions={southernBranch}
          pathOptions={{ color: "#0284c7", weight: 2.5, opacity: 0.6, dashArray: "4, 6" }}
        />
        <Polyline
          positions={andhraBranch}
          pathOptions={{ color: "#0ea5e9", weight: 2.5, opacity: 0.6, dashArray: "4, 6" }}
        />
        <Polyline
          positions={coastalAndhraBranch}
          pathOptions={{ color: "#10b981", weight: 2.5, opacity: 0.7, dashArray: "4, 6" }}
        />

        {/* Stations */}
        {stations.map((stn) => (
          <CircleMarker
            key={stn.code}
            center={[stn.lat, stn.lng]}
            radius={5}
            pathOptions={{
              color: "#38bdf8",
              fillColor: "#0f172a",
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Tooltip direction="top" offset={[0, -5]} opacity={0.9} permanent={false}>
              <div className="text-[11px] font-sans">
                <span className="font-bold text-cyan-400">{stn.name}</span> ({stn.code})
                <br />
                Platforms: {stn.platforms} | {stn.division}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Active Trains */}
        {trains.map((train) => {
          const lat = train.coordinates?.lat || 28.6139;
          const lng = train.coordinates?.lng || 77.2090;
          const isSelected = selectedTrain && selectedTrain.train_no === train.train_no;
          const isDelayed = (train.predicted_delay_min || 0) > 15;

          return (
            <Marker
              key={train.train_no}
              position={[lat, lng]}
              icon={createTrainIcon(train.type, isDelayed, isSelected, train.bearing || 0)}
              eventHandlers={{
                click: () => onSelectTrain(train),
              }}
            >
              <Popup>
                <div className="text-xs space-y-1.5 p-1 min-w-[210px]">
                  <div className="flex justify-between items-start border-b border-slate-700 pb-1">
                    <div>
                      <p className="font-bold text-cyan-300 text-sm">{train.name}</p>
                      <p className="text-[10px] text-slate-400">#{train.train_no} • {train.type}</p>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      train.journey_status === "COMPLETED"
                        ? "bg-blue-950 text-blue-300 border border-blue-800"
                        : train.journey_status === "NOT_STARTED"
                        ? "bg-amber-950 text-amber-300 border border-amber-800"
                        : isDelayed
                        ? "bg-rose-950 text-rose-300 border border-rose-800"
                        : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    }`}>
                      {train.journey_status === "COMPLETED"
                        ? "TERMINATED"
                        : train.journey_status === "NOT_STARTED"
                        ? "YET TO DEPART"
                        : train.predicted_delay_min
                        ? `+${train.predicted_delay_min}m`
                        : "ON TIME"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-slate-400 text-[10px]">CURRENT SPEED</span>
                      <p className="font-mono font-bold text-white">{train.speed_kmh} km/h</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px]">DYNAMIC ETA</span>
                      <p className="font-mono font-bold text-amber-400">{train.dynamic_eta || train.scheduled_arrival}</p>
                    </div>
                  </div>

                  <div className="bg-slate-900/90 p-1.5 rounded text-[10px] text-slate-300 space-y-1">
                    {train.status_note && (
                      <div className="bg-cyan-950/60 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800/80 font-bold flex items-center gap-1">
                        <span>📍</span>
                        <span>{train.status_note}</span>
                      </div>
                    )}
                    <div>Section: <span className="font-mono text-cyan-300">{train.current_section}</span></div>
                    <div className="flex justify-between">
                      <span>Platform: <strong className="text-white">{train.assigned_platform}</strong></span>
                      <span className="text-cyan-400 font-mono">Bearing: {train.bearing || 0}°</span>
                    </div>
                    <div className="pt-0.5 border-t border-slate-800 flex items-center justify-between text-[9px]">
                      <span className="text-slate-400">DATA FEED:</span>
                      <span className={`font-bold font-mono ${train.data_source === "LIVE_RAILRADAR" ? "text-emerald-400" : "text-cyan-400"}`}>
                        {train.data_source === "LIVE_RAILRADAR" ? "🟢 LIVE RAILRADAR" : "⚡ SIMULATION"}
                      </span>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
