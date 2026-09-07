import React, { useState, useEffect, useRef } from "react";
import Navbar from "./components/Navbar";
import PassengerDashboard from "./components/passenger/PassengerDashboard";
import ControllerDashboard from "./components/controller/ControllerDashboard";
import StationMasterDashboard from "./components/station_master/StationMasterDashboard";
import RailMap from "./components/map/RailMap";
import PnrModal from "./components/pnr/PnrModal";
import { Train, Layers, Shield, Radio, Activity, Eye, AlertCircle } from "lucide-react";

export default function App() {
  const [currentRole, setRole] = useState("passenger");
  const [trains, setTrains] = useState([]);
  const [stations, setStations] = useState([]);
  const [selectedTrain, setSelectedTrain] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [proximityAlerts, setProximityAlerts] = useState([]);
  const [sectionSummary, setSectionSummary] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [isPnrOpen, setIsPnrOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard" or "map_split"
  const [trackerStatus, setTrackerStatus] = useState(null);
  const [dataSourceMode, setDataSourceMode] = useState("HYBRID_SIMULATION");

  const wsRef = useRef(null);

  // 1. Fetch initial static stations & trains
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [stnRes, trainRes] = await Promise.all([
          fetch("http://localhost:8080/api/stations"),
          fetch("http://localhost:8080/api/trains"),
        ]);
        const stnData = await stnRes.json();
        const trainData = await trainRes.json();
        setStations(stnData);
        setTrains(trainData);
        if (trainData.length > 0) {
          setSelectedTrain(trainData[0]);
        }
      } catch (e) {
        console.error("Failed to load initial data", e);
      }
    };
    fetchInitialData();
  }, []);

  // 2. Connect to WebSocket telemetry stream
  useEffect(() => {
    let reconnectTimeout = null;

    const connectWebSocket = () => {
      const wsUrl = "ws://localhost:8080/ws/telemetry";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log("[RailFlow AI] WebSocket live feed connected.");
      };

      ws.onmessage = (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          if (snapshot.trains) {
            setTrains(snapshot.trains);
            // Keep selected train synchronized
            setSelectedTrain((prev) => {
              if (!prev) return snapshot.trains[0];
              const updated = snapshot.trains.find((t) => t.train_no === prev.train_no);
              return updated || snapshot.trains[0];
            });
          }
          if (snapshot.conflicts) setConflicts(snapshot.conflicts);
          if (snapshot.proximity_alerts) setProximityAlerts(snapshot.proximity_alerts);
          if (snapshot.section_summary) setSectionSummary(snapshot.section_summary);
          if (snapshot.tracker_status) setTrackerStatus(snapshot.tracker_status);
          if (snapshot.data_source_mode) setDataSourceMode(snapshot.data_source_mode);
        } catch (err) {
          console.error("Error parsing WebSocket payload:", err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log("[RailFlow AI] WebSocket disconnected, retrying in 3s...");
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#070c18] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Navbar */}
      <Navbar
        currentRole={currentRole}
        setRole={setRole}
        isConnected={isConnected}
        onOpenPnrModal={() => setIsPnrOpen(true)}
        criticalAlertCount={conflicts.length}
        trackerStatus={trackerStatus}
        dataSourceMode={dataSourceMode}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-4">
        {/* Role Context Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 backdrop-blur-md px-4 py-2.5 rounded-xl border border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Current Viewpoint:</span>
            <span className="font-bold text-cyan-400 capitalize">
              {currentRole.replace("_", " ")} Mode
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">Section:</span>
            <span className="font-mono font-semibold text-slate-200">NDLS – CNB Corridor (North Central)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-3 py-1 rounded-lg transition-colors font-medium ${
                activeTab === "dashboard"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Control Center
            </button>
            <button
              onClick={() => setActiveTab("map_split")}
              className={`px-3 py-1 rounded-lg transition-colors font-medium flex items-center gap-1.5 ${
                activeTab === "map_split"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Full Fleet Map</span>
            </button>
          </div>
        </div>

        {/* View Switching */}
        {activeTab === "map_split" ? (
          <div className="h-[76vh]">
            <RailMap
              trains={trains}
              stations={stations}
              selectedTrain={selectedTrain}
              onSelectTrain={setSelectedTrain}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Live Interactive Map Box */}
            <div className="h-[380px]">
              <RailMap
                trains={trains}
                stations={stations}
                selectedTrain={selectedTrain}
                onSelectTrain={setSelectedTrain}
              />
            </div>

            {/* Dashboard Specific to Role */}
            {currentRole === "passenger" ? (
              <PassengerDashboard
                trains={trains}
                selectedTrain={selectedTrain}
                onSelectTrain={setSelectedTrain}
                stations={stations}
                onOpenPnrModal={() => setIsPnrOpen(true)}
              />
            ) : currentRole === "station_master" ? (
              <StationMasterDashboard
                trains={trains}
                stations={stations}
                conflicts={conflicts}
                selectedTrain={selectedTrain}
                onSelectTrain={setSelectedTrain}
              />
            ) : (
              <ControllerDashboard
                trains={trains}
                conflicts={conflicts}
                proximityAlerts={proximityAlerts}
                sectionSummary={sectionSummary}
                selectedTrain={selectedTrain}
                onSelectTrain={setSelectedTrain}
              />
            )}
          </div>
        )}
      </main>

      {/* PNR Modal */}
      <PnrModal isOpen={isPnrOpen} onClose={() => setIsPnrOpen(false)} />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-3 px-4 text-center text-xs text-slate-500">
        <p>
          RailFlow AI • Smart Railway Traffic Management & Dynamic ETA Prediction • Built for Smart India Hackathon (SIH 2026 Problem Statement 26028)
        </p>
      </footer>
    </div>
  );
}
