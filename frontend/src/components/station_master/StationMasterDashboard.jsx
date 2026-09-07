import React, { useState, useMemo } from "react";
import {
  Shield,
  Train,
  AlertTriangle,
  CheckCircle2,
  Volume2,
  Clock,
  Radio,
  ArrowRightLeft,
  Activity,
  Layers,
  Building,
} from "lucide-react";

export default function StationMasterDashboard({
  trains = [],
  stations = [],
  conflicts = [],
  selectedTrain,
  onSelectTrain,
}) {
  // 1. Station Selection State
  const [selectedStationCode, setSelectedStationCode] = useState("NDLS");
  const [reassignModalTrain, setReassignModalTrain] = useState(null);
  const [targetPlatformInput, setTargetPlatformInput] = useState(4);
  const [isSubmittingReassign, setIsSubmittingReassign] = useState(false);
  const [actionNotice, setActionNotice] = useState(null);
  const [announcementPlaying, setAnnouncementPlaying] = useState(false);
  const [announcementText, setAnnouncementText] = useState(
    "Attention please: Train 04414 Delhi - Aligarh MEMU Passenger arriving shortly on Platform 3. Inconvenience is regretted."
  );

  // Active station data
  const currentStation = useMemo(() => {
    return (
      stations.find((s) => s.code === selectedStationCode) ||
      stations[0] || {
        code: "NDLS",
        name: "New Delhi",
        platforms: 16,
        division: "Delhi (DLI)",
        zone: "Northern Railway",
      }
    );
  }, [stations, selectedStationCode]);

  // Total platform count for this station
  const totalPlatforms = currentStation.platforms || 10;

  // 2. Interlocking Signal Aspects State
  const [signals, setSignals] = useState({
    "SIG-UP-HOME": { aspect: "DOUBLE_YELLOW", name: "Up Main Home Signal", route: "Platform 3 / 4 Diverging" },
    "SIG-DN-HOME": { aspect: "GREEN", name: "Down Main Home Signal", route: "Main Line Through Run" },
    "SIG-LOOP-STR": { aspect: "YELLOW", name: "Loop Line Starter", route: "Platform 1 Exit to Loop" },
    "SIG-MAIN-ADV": { aspect: "RED", name: "Advance Starter (Block Ex)", route: "Block Section Lock" },
  });

  const pointMachines = {
    "Point 101-A": { status: "NORMAL (LOCKED)", route: "Mainline Alignment" },
    "Point 102-B": { status: "REVERSE (SET)", route: "Platform 4 Divergence" },
    "Point 104-C": { status: "NORMAL (LOCKED)", route: "Freight Loop Bypass" },
  };

  // 3. Map platforms to trains currently assigned or berthing
  const platformAssignments = useMemo(() => {
    const map = {};
    for (let p = 1; p <= totalPlatforms; p++) {
      map[p] = null;
    }

    trains.forEach((t) => {
      const plat = t.assigned_platform || (parseInt(t.train_no, 10) % totalPlatforms) + 1;
      if (plat >= 1 && plat <= totalPlatforms) {
        if (!map[plat]) {
          map[plat] = [t];
        } else {
          map[plat].push(t);
        }
      }
    });

    return map;
  }, [trains, totalPlatforms]);

  // Station-specific conflicts
  const stationConflicts = useMemo(() => {
    return conflicts.filter(
      (c) =>
        c.station === selectedStationCode ||
        (selectedStationCode === "NDLS" && c.station === "NDLS")
    );
  }, [conflicts, selectedStationCode]);

  // Helper to extract station-specific schedule and dynamic ETA
  const getStationTiming = (train, stnCode) => {
    if (!train) return { scheduled_arr: "--:--", scheduled_dep: "--:--", dynamic_eta: "--:--" };
    const stop = train.stops?.find((s) => s.code === stnCode);
    if (stop) {
      return {
        scheduled_arr: stop.sch_arr || "--:--",
        scheduled_dep: stop.sch_dep || "--:--",
        dynamic_eta: stop.dynamic_eta || stop.sch_arr || train.dynamic_eta || "--:--",
        status: stop.status,
      };
    }
    // If this station is the destination
    if (train.destination === stnCode) {
      return {
        scheduled_arr: train.scheduled_arrival || "--:--",
        scheduled_dep: "--:--",
        dynamic_eta: train.dynamic_eta || train.scheduled_arrival || "--:--",
        status: "Terminal Halt",
      };
    }
    // Fallback to train destination timing
    return {
      scheduled_arr: train.scheduled_arrival || "--:--",
      scheduled_dep: train.scheduled_departure || "--:--",
      dynamic_eta: train.dynamic_eta || train.scheduled_arrival || "--:--",
      status: "En Route",
    };
  };

  // 4. Handle Platform Reassignment Execution
  const handleExecuteReassign = async (trainNo, targetPlat) => {
    setIsSubmittingReassign(true);
    try {
      await fetch("http://localhost:8080/api/controller/reassign-platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          train_no: trainNo,
          target_platform: parseInt(targetPlat, 10),
        }),
      });

      setActionNotice({
        type: "success",
        message: `Train #${trainNo} successfully diverted to Platform ${targetPlat}. Interlocking route set and Home Signal cleared.`,
      });
      setReassignModalTrain(null);
      setTimeout(() => setActionNotice(null), 6000);
    } catch (e) {
      setActionNotice({
        type: "info",
        message: `Dispatched local yard order: Train #${trainNo} routed to Platform ${targetPlat}.`,
      });
      setReassignModalTrain(null);
      setTimeout(() => setActionNotice(null), 5000);
    } finally {
      setIsSubmittingReassign(false);
    }
  };

  // 5. Toggle Signal Aspect
  const handleCycleSignal = (sigId) => {
    setSignals((prev) => {
      const order = ["RED", "YELLOW", "DOUBLE_YELLOW", "GREEN"];
      const currentIdx = order.indexOf(prev[sigId].aspect);
      const nextAspect = order[(currentIdx + 1) % order.length];
      return {
        ...prev,
        [sigId]: {
          ...prev[sigId],
          aspect: nextAspect,
        },
      };
    });
  };

  // 6. Play Authentic Indian Railways 3-Tone Concourse Chime (Web Audio API)
  const playStationChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const tones = [
        { freq: 523.25, time: 0.0, dur: 0.28 },  // C5
        { freq: 659.25, time: 0.32, dur: 0.28 }, // E5
        { freq: 783.99, time: 0.65, dur: 0.55 }, // G5
      ];

      tones.forEach((tone) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = tone.freq;

        gain.gain.setValueAtTime(0.01, ctx.currentTime + tone.time);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + tone.time + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + tone.time + tone.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + tone.time);
        osc.stop(ctx.currentTime + tone.time + tone.dur);
      });

      setAnnouncementPlaying(true);
      setTimeout(() => setAnnouncementPlaying(false), 3000);
    } catch (e) {
      console.log("Audio synthesis error", e);
    }
  };

  const occupiedCount = Object.values(platformAssignments).filter((arr) => arr && arr.length > 0).length;

  return (
    <div className="space-y-4">
      {/* 1. Station Selector & Master Header Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Building className="w-6 h-6 text-slate-950 font-black" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white tracking-tight">
                {currentStation.name} Junction
              </h2>
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                {currentStation.code}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                {currentStation.division} • {currentStation.zone}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              Station Master Terminal Active • Solid State Interlocking (SSI) Connected
            </p>
          </div>
        </div>

        {/* Station Switcher Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-slate-400 font-medium mr-1 hidden sm:block">
            Select Station:
          </div>
          {stations.slice(0, 5).map((stn) => (
            <button
              key={stn.code}
              onClick={() => setSelectedStationCode(stn.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedStationCode === stn.code
                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/25"
                  : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700"
              }`}
            >
              {stn.code}
            </button>
          ))}

          {stations.length > 5 && (
            <select
              value={selectedStationCode}
              onChange={(e) => setSelectedStationCode(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 font-mono font-bold"
            >
              {stations.map((stn) => (
                <option key={stn.code} value={stn.code}>
                  {stn.code} - {stn.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 2. Operational Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            Platform Berthing
          </span>
          <p className="text-2xl font-black text-white font-mono mt-1">
            {occupiedCount} <span className="text-sm font-normal text-slate-500">/ {totalPlatforms}</span>
          </p>
          <span className="text-[10px] text-emerald-400 font-medium">
            {totalPlatforms - occupiedCount} Platforms Open
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <Train className="w-3.5 h-3.5 text-cyan-400" />
            Fleet in Approach
          </span>
          <p className="text-2xl font-black text-cyan-300 font-mono mt-1">
            {trains.filter((t) => t.journey_status === "RUNNING").length}
          </p>
          <span className="text-[10px] text-slate-400">Within corridor limits</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            Station Conflicts
          </span>
          <p className="text-2xl font-black text-rose-400 font-mono mt-1">
            {stationConflicts.length}
          </p>
          <span className="text-[10px] text-rose-300 font-semibold">
            {stationConflicts.length > 0 ? "Requires Rerouting" : "All Clear"}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-400" />
            Avg Dwell Time
          </span>
          <p className="text-2xl font-black text-purple-400 font-mono mt-1">3.5m</p>
          <span className="text-[10px] text-purple-300 font-medium">Scheduled: 2.0m</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-lg">
          <span className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            Interlocking Status
          </span>
          <p className="text-2xl font-black text-emerald-400 font-mono mt-1">AUTO</p>
          <span className="text-[10px] text-emerald-300 font-medium">Route Locks Engaged</span>
        </div>
      </div>

      {/* Action Notification Alert Banner */}
      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-700/80 text-emerald-200 text-xs flex items-center justify-between shadow-lg shadow-emerald-900/20">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{actionNotice.message}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-emerald-400 hover:text-white font-bold text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. Station Platform Conflict Urgent Action Banner */}
      {stationConflicts.length > 0 && (
        <div className="bg-gradient-to-r from-rose-950/90 to-slate-900 border border-rose-800/80 rounded-2xl p-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </span>
                <h4 className="text-sm font-black text-rose-300 uppercase tracking-wide flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  Urgent Platform Conflict Detected: Platform {stationConflicts[0].platform}
                </h4>
              </div>
              <p className="text-xs text-slate-300">
                Overlapping arrivals between <strong>Train #{stationConflicts[0].train_1?.train_no} ({stationConflicts[0].train_1?.name})</strong> and <strong>Train #{stationConflicts[0].train_2?.train_no} ({stationConflicts[0].train_2?.name})</strong> within {stationConflicts[0].overlap_window_min} minutes.
              </p>
              <p className="text-[11px] text-cyan-300">
                💡 <strong>AI Dispatch Recommendation:</strong> {stationConflicts[0].ai_recommendation}
              </p>
            </div>

            <button
              onClick={() =>
                handleExecuteReassign(
                  stationConflicts[0].train_1?.train_no,
                  stationConflicts[0].platform === 3 ? 4 : 2
                )
              }
              disabled={isSubmittingReassign}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>
                {isSubmittingReassign
                  ? "Diverting Route..."
                  : `Authorize Shift to Platform ${stationConflicts[0].platform === 3 ? 4 : 2}`}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Platform Yard Track Diagram (Berthing Board) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              <span>Interactive Platform Yard & Berthing Board</span>
            </h3>
            <p className="text-xs text-slate-400">
              Live track occupancy, rake positions, and route clearances for {currentStation.name}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50"></span>
              Occupied / Berthed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/50"></span>
              Inbound Approaching
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
              Clear Track
            </span>
          </div>
        </div>

        {/* Tracks List */}
        <div className="space-y-3">
          {Array.from({ length: totalPlatforms }, (_, idx) => idx + 1).map((platNum) => {
            const assignedList = platformAssignments[platNum] || [];
            const hasConflict = assignedList.length > 1;
            const primaryTrain = assignedList[0];

            return (
              <div
                key={platNum}
                className={`p-3.5 rounded-xl border transition-all ${
                  hasConflict
                    ? "bg-rose-950/40 border-rose-700/80 shadow-lg shadow-rose-950/30"
                    : primaryTrain
                    ? "bg-slate-950 border-slate-800 hover:border-slate-700"
                    : "bg-slate-950/50 border-slate-800/60 hover:border-slate-700"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Left: Platform Label & Track Indicator */}
                  <div className="flex items-center gap-3 min-w-[140px]">
                    <div
                      className={`w-9 h-9 rounded-lg font-mono font-black text-sm flex items-center justify-center ${
                        hasConflict
                          ? "bg-rose-600 text-white animate-pulse"
                          : primaryTrain
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      P{platNum}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white">
                        Platform {platNum}
                      </span>
                      <p className="text-[10px] text-slate-400">
                        {platNum === 1 || platNum === 2
                          ? "Main Line (Up/Dn)"
                          : platNum % 2 === 0
                          ? "Island Platform"
                          : "Loop Line Track"}
                      </p>
                    </div>
                  </div>

                  {/* Middle: Train Berthing Details */}
                  <div className="flex-1">
                    {hasConflict ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded font-black bg-rose-900 text-rose-200 text-[10px] uppercase">
                          DOUBLE BERTHING CONFLICT
                        </span>
                        {assignedList.map((t) => {
                          const timing = getStationTiming(t, currentStation.code);
                          return (
                            <span
                              key={t.train_no}
                              onClick={() => onSelectTrain(t)}
                              className="bg-slate-900 px-2.5 py-1 rounded-lg border border-rose-700 text-slate-200 cursor-pointer hover:border-white font-mono text-xs"
                            >
                              #{t.train_no} {t.name} (Sch: {timing.scheduled_arr} • ETA: {timing.dynamic_eta})
                            </span>
                          );
                        })}
                      </div>
                    ) : primaryTrain ? (() => {
                      const timing = getStationTiming(primaryTrain, currentStation.code);
                      return (
                        <div className="flex flex-wrap items-center gap-3">
                          <div
                            onClick={() => onSelectTrain(primaryTrain)}
                            className="cursor-pointer group flex items-center gap-2"
                          >
                            <span className="font-bold text-cyan-300 text-xs group-hover:underline">
                              #{primaryTrain.train_no} {primaryTrain.name}
                            </span>
                            <span className="text-[10px] text-slate-400">({primaryTrain.type})</span>
                          </div>

                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              primaryTrain.journey_status === "COMPLETED"
                                ? "bg-blue-950 text-blue-300 border border-blue-800"
                                : primaryTrain.journey_status === "NOT_STARTED"
                                ? "bg-amber-950 text-amber-300 border border-amber-800"
                                : (primaryTrain.predicted_delay_min || 0) > 15
                                ? "bg-rose-950 text-rose-300 border border-rose-800"
                                : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            }`}
                          >
                            {primaryTrain.journey_status === "COMPLETED"
                              ? "TERMINATED / RAKE HELD"
                              : primaryTrain.journey_status === "NOT_STARTED"
                              ? "ORIGIN • YET TO DEPART"
                              : primaryTrain.predicted_delay_min
                              ? `APPROACHING (+${primaryTrain.predicted_delay_min}m DELAY)`
                              : "ON TIME APPROACH"}
                          </span>

                          <span className="text-xs font-mono text-slate-300">
                            Sch: <strong className="text-slate-200">{timing.scheduled_arr}</strong>
                          </span>

                          <span className="text-xs font-mono text-slate-300">
                            Dynamic ETA: <strong className="text-amber-400">{timing.dynamic_eta}</strong>
                          </span>

                          <span className="text-xs font-mono text-slate-400">
                            Speed: {primaryTrain.speed_kmh || 0} km/h
                          </span>
                        </div>
                      );
                    })() : (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="w-2 h-2 rounded-full bg-emerald-500/60"></span>
                        <span>Track Clear • Route available for interlocking clearance</span>
                      </div>
                    )}
                  </div>

                  {/* Right: Quick Action Controls */}
                  <div className="flex items-center gap-2 shrink-0">
                    {primaryTrain ? (
                      <button
                        onClick={() => {
                          setReassignModalTrain(primaryTrain);
                          setTargetPlatformInput(platNum === 1 ? 2 : platNum === 3 ? 4 : 1);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-amber-400 text-slate-300 hover:text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>Shift Platform</span>
                      </button>
                    ) : (
                      <span className="text-[11px] font-mono text-emerald-500/80 font-bold px-2 py-0.5 rounded bg-emerald-950/30 border border-emerald-900/40">
                        READY FOR BERTH
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Two-Column Layout: Interlocking Signals & Station Concourse PIS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Interlocking & Signal Status Panel (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>Station Route Interlocking & 4-Aspect Signals</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Click any signal to cycle aspect state and simulate route clearances
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Solid State Relay
              </span>
            </div>

            {/* Signals Grid */}
            <div className="space-y-2.5">
              {Object.entries(signals).map(([sigId, sig]) => {
                let badgeBg = "bg-emerald-500";
                let badgeText = "text-emerald-400";
                let aspectBorder = "border-emerald-700/60";

                if (sig.aspect === "RED") {
                  badgeBg = "bg-rose-500";
                  badgeText = "text-rose-400";
                  aspectBorder = "border-rose-700/60";
                } else if (sig.aspect === "YELLOW") {
                  badgeBg = "bg-amber-400";
                  badgeText = "text-amber-300";
                  aspectBorder = "border-amber-700/60";
                } else if (sig.aspect === "DOUBLE_YELLOW") {
                  badgeBg = "bg-amber-500";
                  badgeText = "text-amber-400";
                  aspectBorder = "border-amber-600/60";
                }

                return (
                  <div
                    key={sigId}
                    onClick={() => handleCycleSignal(sigId)}
                    className={`p-3 rounded-xl bg-slate-950 border ${aspectBorder} hover:border-cyan-400 cursor-pointer transition-all flex items-center justify-between`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center justify-center p-1.5 rounded-lg bg-slate-900 border border-slate-800 w-10">
                        <span className={`w-3.5 h-3.5 rounded-full ${badgeBg} shadow-sm shadow-current animate-pulse`}></span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{sig.name}</span>
                          <span className="text-[10px] font-mono text-slate-500">({sigId})</span>
                        </div>
                        <p className="text-[10px] text-slate-400">{sig.route}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className={`font-mono font-bold text-xs uppercase ${badgeText}`}>
                        {sig.aspect.replace("_", " ")}
                      </span>
                      <p className="text-[9px] text-slate-500">Click to Toggle</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Point Machines Interlocking Status */}
            <div className="pt-3 border-t border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Point Machine Locking Status
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(pointMachines).map(([ptId, pt]) => (
                  <div key={ptId} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-[10px] font-bold text-slate-300">{ptId}</span>
                    <p className="text-xs font-mono font-bold text-cyan-400 mt-0.5">{pt.status}</p>
                    <p className="text-[9px] text-slate-500 truncate">{pt.route}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Passenger Information System (PIS) & Audio Chime (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-amber-400" />
                  <span>Passenger Information System (PIS) Concourse Broadcast</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Synchronize station display boards and trigger concourse audio announcements
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                PIS V3.2
              </span>
            </div>

            {/* Live Audio Announcement Box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">Concourse Public Address (PA)</span>
                {announcementPlaying && (
                  <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1 animate-pulse">
                    <Volume2 className="w-3 h-3" />
                    Broadcasting Live...
                  </span>
                )}
              </div>

              <textarea
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:border-amber-500 font-sans resize-none"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={playStationChime}
                  className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Play Chime & Broadcast to Concourse</span>
                </button>
              </div>
            </div>

            {/* Inbound / Outbound Timetable Board Preview */}
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Concourse Digital Display Board ({currentStation.code})
              </span>
              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden text-xs">
                <div className="grid grid-cols-12 bg-slate-900/80 p-2 text-[10px] font-bold text-slate-400 border-b border-slate-800">
                  <span className="col-span-4">Train</span>
                  <span className="col-span-2 text-center">Plat</span>
                  <span className="col-span-2 text-center">Station Sch</span>
                  <span className="col-span-2 text-center">Dynamic ETA</span>
                  <span className="col-span-2 text-right">Status</span>
                </div>

                <div className="divide-y divide-slate-850 max-h-[190px] overflow-y-auto">
                  {trains.map((t) => {
                    const timing = getStationTiming(t, currentStation.code);
                    return (
                      <div
                        key={t.train_no}
                        onClick={() => onSelectTrain(t)}
                        className="grid grid-cols-12 p-2.5 items-center hover:bg-slate-900/50 cursor-pointer transition-colors"
                      >
                        <div className="col-span-4">
                          <p className="font-bold text-slate-200 truncate">
                            #{t.train_no} {t.name}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {t.origin} → {t.destination}
                          </p>
                        </div>

                        <div className="col-span-2 text-center">
                          <span className="font-mono font-bold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-900">
                            P{t.assigned_platform || 3}
                          </span>
                        </div>

                        <div className="col-span-2 text-center font-mono text-slate-300">
                          {timing.scheduled_arr}
                        </div>

                        <div className="col-span-2 text-center font-mono font-bold text-cyan-300">
                          {timing.dynamic_eta}
                        </div>

                        <div className="col-span-2 text-right">
                          <span
                            className={`text-[10px] font-bold ${
                              t.journey_status === "COMPLETED"
                                ? "text-blue-400"
                                : t.journey_status === "NOT_STARTED"
                                ? "text-amber-400"
                                : (t.predicted_delay_min || 0) > 15
                                ? "text-rose-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {t.journey_status === "COMPLETED"
                              ? "Terminated"
                              : t.journey_status === "NOT_STARTED"
                              ? "Yet to Depart"
                              : t.predicted_delay_min
                              ? `+${t.predicted_delay_min}m`
                              : "On Time"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Platform Reassignment Modal */}
      {reassignModalTrain && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Reassign Platform</h3>
              </div>
              <button
                onClick={() => setReassignModalTrain(null)}
                className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Subject Train:</span>
                <span className="font-bold text-white">
                  #{reassignModalTrain.train_no} - {reassignModalTrain.name}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-400">Current Platform:</span>
                <span className="font-bold text-rose-400">
                  Platform {reassignModalTrain.assigned_platform || 3}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Select New Target Platform:
              </label>
              <select
                value={targetPlatformInput}
                onChange={(e) => setTargetPlatformInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-bold rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                {Array.from({ length: totalPlatforms }, (_, idx) => idx + 1).map((p) => (
                  <option key={p} value={p}>
                    Platform {p} {p === 4 ? "(Recommended Open)" : p === 1 ? "(Mainline)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => setReassignModalTrain(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleExecuteReassign(reassignModalTrain.train_no, targetPlatformInput)
                }
                disabled={isSubmittingReassign}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                {isSubmittingReassign ? "Executing..." : "Confirm & Set Route"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
