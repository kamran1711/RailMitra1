import React, { useState } from "react";
import { Search, Train, Clock, MapPin, AlertCircle, ArrowRight, ShieldAlert, Sparkles, Navigation, Gauge, CheckCircle2 } from "lucide-react";

export default function PassengerDashboard({
  trains = [],
  selectedTrain,
  onSelectTrain,
  stations = [],
  onOpenPnrModal,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [fromStation, setFromStation] = useState("NDLS");
  const [toStation, setToStation] = useState("CNB");

  const filteredTrains = trains.filter((t) => {
    const q = searchQuery.toLowerCase();
    return (
      t.train_no.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q)
    );
  });

  const active = selectedTrain || trains[0] || {};
  const isDelayed = (active.predicted_delay_min || 0) > 5;
  const isLocked = active.platform_status === "LOCKED";

  return (
    <div className="space-y-4">
      {/* Search Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 p-4 rounded-2xl border border-slate-800 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>My Journey & Live Train Search</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-normal">
                Real-Time Dynamic Telemetry
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Select or search your train to view dynamic ETA forecasts updated every 2.5 seconds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Train No. / Name..."
                className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-xl pl-9 pr-3 py-2 w-56 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <button
              onClick={onOpenPnrModal}
              className="px-3 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center gap-1.5"
            >
              <span>Check PNR Live</span>
            </button>
          </div>
        </div>

        {/* Quick Route Selector Pills */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800/80 overflow-x-auto text-xs">
          <span className="text-slate-500 text-[11px] uppercase font-bold">Popular:</span>
          {trains.map((t) => (
            <button
              key={t.train_no}
              onClick={() => onSelectTrain(t)}
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                active.train_no === t.train_no
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold"
                  : "bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              <Train className="w-3 h-3 text-cyan-400" />
              <span>
                {t.name} ({t.train_no})
                {t.train_no === "07091" ? " • Halfway" : ""}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Passenger 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Train Live Telemetry & My Journey Card (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Active Train Spotlight Card */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl relative overflow-hidden">
            {/* Top Accent Glow */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500"></div>

            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                    #{active.train_no}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{active.type}</span>
                </div>
                <h3 className="text-xl font-black text-white mt-1">{active.name}</h3>
                
                {/* Lifecycle Subtitle */}
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs font-medium">
                  {active.journey_status === "COMPLETED" ? (
                    <span className="flex items-center gap-1.5 text-blue-300 bg-blue-950/60 px-2.5 py-0.5 rounded-lg border border-blue-800/80">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Terminated at Final Destination: <strong className="text-white">{active.current_station_name || active.destination}</strong></span>
                    </span>
                  ) : active.journey_status === "NOT_STARTED" ? (
                    <span className="flex items-center gap-1.5 text-amber-300 bg-amber-950/60 px-2.5 py-0.5 rounded-lg border border-amber-800/80">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>Staged at Origin: <strong className="text-white">{active.current_station_name || active.source}</strong> • Departs: <strong className="text-white">{active.origin_dep_time || active.scheduled_departure || "--:--"}</strong></span>
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-slate-300">
                      <span className="flex items-center gap-1 text-slate-400">
                        <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                        Passed: <strong className="text-slate-200">{active.current_station_name || active.current_station || "In Section"}</strong>
                      </span>
                      <span className="text-slate-600">➔</span>
                      <span className="flex items-center gap-1 text-cyan-300">
                        <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                        Approaching: <strong className="text-cyan-200">{active.next_station_name || active.next_station}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Status Badge */}
              <div className="text-right">
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                    active.journey_status === "COMPLETED"
                      ? "bg-blue-950/90 text-blue-300 border border-blue-700"
                      : active.journey_status === "NOT_STARTED"
                      ? "bg-amber-950/90 text-amber-300 border border-amber-700"
                      : isDelayed
                      ? "bg-rose-950/80 text-rose-300 border border-rose-800"
                      : "bg-emerald-950/80 text-emerald-300 border border-emerald-800"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    active.journey_status === "COMPLETED"
                      ? "bg-blue-400"
                      : active.journey_status === "NOT_STARTED"
                      ? "bg-amber-400 animate-pulse"
                      : isDelayed
                      ? "bg-rose-400 animate-ping"
                      : "bg-emerald-400"
                  }`}></span>
                  <span>
                    {active.journey_status === "COMPLETED"
                      ? "JOURNEY COMPLETED"
                      : active.journey_status === "NOT_STARTED"
                      ? "YET TO DEPART"
                      : isDelayed
                      ? `DELAY: +${active.predicted_delay_min} MINS`
                      : "ON SCHEDULE"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Confidence: <span className="text-cyan-400 font-mono font-bold">{active.confidence_score || 94.2}%</span>
                </p>
              </div>
            </div>

            {/* Platform Conflict Alert (From Video: Platform 1 Locked warning) */}
            {isLocked && (
              <div className="mt-4 p-3.5 rounded-xl bg-gradient-to-r from-rose-950/60 to-slate-900 border border-rose-800/80 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-rose-300 uppercase tracking-wide">
                    Live Station Alert: Platform Reallocation
                  </h4>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Platform {active.assigned_platform} at terminal is currently locked due to section congestion.
                    RailFlow AI recommends diversion to nearest spot: <strong className="text-emerald-400">Platform {active.alternative_platform}</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Dynamic ETA vs Scheduled Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  Scheduled ETA
                </span>
                <p className="text-lg font-bold text-slate-300 font-mono mt-1">
                  {active.approaching_scheduled_arrival || active.scheduled_arrival}
                </p>
                <span className="text-[10px] text-slate-500 truncate block">
                  {active.approaching_station_name ? `At ${active.approaching_station_code || "Next"} • Term: ${active.scheduled_arrival}` : "Official timetable"}
                </span>
              </div>

              <div className="bg-gradient-to-br from-cyan-950/40 to-slate-950/80 p-3 rounded-xl border border-cyan-800/50">
                <span className="text-[10px] text-cyan-400 uppercase font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-cyan-400" />
                  Dynamic AI ETA
                </span>
                <p className="text-xl font-black text-cyan-300 font-mono mt-0.5">
                  {active.approaching_dynamic_eta || active.dynamic_eta || active.scheduled_arrival}
                </p>
                <span className="text-[10px] text-cyan-500/80 font-mono truncate block">
                  {active.approaching_station_name ? `Dest ETA: ${active.dynamic_eta || active.scheduled_arrival}` : `Range: ${active.expected_delay_range || "0 - 4 mins"}`}
                </span>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <Gauge className="w-3 h-3 text-slate-400" />
                  Current Speed
                </span>
                <p className="text-lg font-bold text-white font-mono mt-1">{active.speed_kmh} km/h</p>
                <span className="text-[10px] text-emerald-400">
                  {active.journey_status === "COMPLETED"
                    ? "Terminated (Stationary)"
                    : active.journey_status === "NOT_STARTED"
                    ? "Boarding (Stationary)"
                    : `Max MPS: ${active.max_speed_kmh}`}
                </span>
              </div>

              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                  <Navigation className="w-3 h-3 text-cyan-400" />
                  {active.journey_status === "COMPLETED"
                    ? "Terminal Station"
                    : active.journey_status === "NOT_STARTED"
                    ? "First Halt Ahead"
                    : "Approaching Stop"}
                </span>
                <p className="text-sm font-bold text-white font-mono mt-1 truncate" title={active.next_station_name || active.next_station}>
                  {active.next_station_name || active.next_station}
                </p>
                <span className="text-[10px] text-cyan-400 font-mono">Platform {active.assigned_platform}</span>
              </div>
            </div>

            {/* Real-Time Journey Progress Bar (Shows Halfway Status) */}
            <div className="mt-4 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5 text-[10px]">
                  <Navigation className="w-3 h-3 text-cyan-400" />
                  Journey Real-Time Progress
                </span>
                <div className="flex items-center gap-2">
                  {(active.journey_progress_pct === 50 || active.segment_progress === 0.5) && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-bold animate-pulse">
                      📍 HALFWAY (50%)
                    </span>
                  )}
                  <span className="text-cyan-300 font-mono font-bold text-xs">
                    {active.journey_progress_pct || Math.round((active.segment_progress || 0.5) * 100)}% Completed
                  </span>
                </div>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400 rounded-full transition-all duration-500"
                  style={{ width: `${active.journey_progress_pct || Math.round((active.segment_progress || 0.5) * 100)}%` }}
                ></div>
              </div>
              <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1.5 font-mono">
                <span>{active.source} ({active.scheduled_departure || "--:--"})</span>
                {active.status_note ? (
                  <span className="text-amber-400 font-semibold truncate px-2">{active.status_note}</span>
                ) : (
                  <span className="text-cyan-400 font-semibold">{active.current_section || "En Route"}</span>
                )}
                <span>{active.destination} ({active.scheduled_arrival || "--:--"})</span>
              </div>
            </div>

            {/* Explainable AI Delay Attribution Preview for Passengers */}
            {active.delay_factors && active.delay_factors.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-800/80">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  Why is my train delayed? (AI Reason Breakdown)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {active.delay_factors.map((factor, idx) => (
                    <div key={idx} className="bg-slate-950/90 p-2.5 rounded-lg border border-slate-800 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200">{factor.category}</span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono text-[10px] font-bold">
                          +{factor.impact_min}m
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{factor.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Route Stations Timeline */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
              Route & Upcoming Station Schedule
            </h4>
            <div className="space-y-2">
              {active.stops?.map((stop, idx) => {
                const isPassed = stop.status === "Passed" || stop.status === "Departed";
                const isApproaching = stop.status === "Approaching";
                const isArrived = stop.status === "Arrived";
                const isOrigin = stop.status === "Origin";
                const prevStop = idx > 0 ? active.stops[idx - 1] : null;
                const showMidwayBanner = prevStop && (prevStop.status === "Departed" || prevStop.status === "Passed") && isApproaching;

                return (
                  <React.Fragment key={idx}>
                    {showMidwayBanner && (
                      <div className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-amber-950/50 via-cyan-950/40 to-slate-900 border border-amber-500/50 flex items-center justify-between text-xs my-1 shadow-lg shadow-amber-950/20">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
                          <span className="font-bold text-amber-300">
                            {active.status_note || `Train In Transit: Section ${active.current_section || "En Route"}`}
                          </span>
                        </div>
                        <span className="font-mono text-cyan-300 font-bold text-[11px] flex items-center gap-1.5">
                          <span>⚡ {active.speed_kmh} km/h</span>
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black text-[10px]">
                            {active.journey_progress_pct || 50}% HALFWAY
                          </span>
                        </span>
                      </div>
                    )}
                    <div
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
                        isArrived
                          ? "bg-blue-950/40 border-blue-700/60 shadow-md shadow-blue-900/20"
                          : isApproaching
                          ? "bg-cyan-950/40 border-cyan-700/60 shadow-md shadow-cyan-900/20"
                          : isOrigin
                          ? "bg-amber-950/40 border-amber-700/60"
                          : "bg-slate-950/50 border-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] ${
                            isArrived
                              ? "bg-blue-500 text-white"
                              : isPassed
                              ? "bg-slate-800 text-slate-400"
                              : isApproaching
                              ? "bg-cyan-500 text-slate-950 animate-pulse"
                              : isOrigin
                              ? "bg-amber-500 text-slate-950"
                              : "bg-slate-900 text-slate-300 border border-slate-700"
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <p className="font-bold text-white">{stop.name} ({stop.code})</p>
                          <p className="text-[10px] text-slate-400">
                            Platform {stop.platform} • Sch: <span className="text-slate-300 font-mono font-semibold">{stop.sch_arr}</span> • <span className="text-cyan-400 font-mono font-bold">ETA: {stop.dynamic_eta || stop.sch_arr}</span>
                          </p>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isArrived
                            ? "bg-blue-950 text-blue-300 border border-blue-700"
                            : isPassed
                            ? "bg-slate-800 text-slate-400"
                            : isApproaching
                            ? "bg-cyan-950 text-cyan-300 border border-cyan-700"
                            : isOrigin
                            ? "bg-amber-950 text-amber-300 border border-amber-700"
                            : "bg-slate-900 text-slate-400"
                        }`}
                      >
                        {stop.status}
                      </span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Other Active Trains in Corridor (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Trains in this Corridor ({filteredTrains.length})</span>
              <span className="text-[10px] text-cyan-400 font-mono">Live Telemetry</span>
            </h3>

            <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
              {filteredTrains.map((train) => {
                const selected = active.train_no === train.train_no;
                const delayed = (train.predicted_delay_min || 0) > 5;

                return (
                  <div
                    key={train.train_no}
                    onClick={() => onSelectTrain(train)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selected
                        ? "bg-gradient-to-r from-slate-850 to-cyan-950/50 border-cyan-500 shadow-md shadow-cyan-500/10"
                        : "bg-slate-950/60 hover:bg-slate-850 border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono font-bold text-cyan-400">#{train.train_no}</span>
                          <span className="text-[10px] text-slate-400">• {train.type}</span>
                        </div>
                        <h4 className="font-bold text-white text-sm mt-0.5">{train.name}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {train.source} ➔ {train.destination} ({train.current_section})
                        </p>
                      </div>

                      <div className="text-right">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            delayed
                              ? "bg-amber-950 text-amber-300 border border-amber-800"
                              : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          }`}
                        >
                          {delayed ? `+${train.predicted_delay_min}m` : "ON TIME"}
                        </span>
                        <p className="text-xs font-mono font-bold text-cyan-300 mt-1">
                          ETA: {train.dynamic_eta || train.scheduled_arrival}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-slate-800/80">
                      <span>Speed: <strong className="text-slate-200">{train.speed_kmh} km/h</strong></span>
                      <span>Platform: <strong className="text-slate-200">{train.assigned_platform}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
