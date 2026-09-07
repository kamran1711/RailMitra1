"""
Real-time Train Telemetry & Dynamic Movement Engine
Simulates realistic GPS movement, speeds, dynamic ETA adjustments, and WebSocket broadcasting.
"""

import asyncio
import copy
from typing import List, Dict, Set
from fastapi import WebSocket
from backend.data.railway_data import TRAINS, STATIONS
from backend.models.eta_model import eta_model
from backend.simulation.track_network import track_network
from backend.services.conflict_detector import conflict_detector


from backend.services.live_tracker import live_tracker


class TelemetryEngine:
    def __init__(self):
        self.active_trains: List[Dict] = copy.deepcopy(TRAINS)
        self.connected_clients: Set[WebSocket] = set()
        self.running = False
        self.live_telemetry_cache: Dict[str, Dict] = {}
        self._initialize_positions()

    def _initialize_positions(self):
        """Initializes train starting positions along the corridor geometry."""
        # Train coordinates initialization
        # AP Express (12723): Approaching Ghaziabad from Aligarh
        self.train_coords = {
            "12723": {"lat": 28.5200, "lng": 77.5800, "step": 0.0035, "target": "NDLS", "bearing": 330},
            "22436": {"lat": 28.2500, "lng": 77.7500, "step": 0.0045, "target": "BSB", "bearing": 135},
            "12302": {"lat": 27.5500, "lng": 78.1500, "step": 0.0040, "target": "HWH", "bearing": 140},
            "12004": {"lat": 26.8500, "lng": 79.2500, "step": 0.0038, "target": "CNB", "bearing": 125},
            "12417": {"lat": 28.4800, "lng": 77.6200, "step": 0.0032, "target": "NDLS", "bearing": 325},
            "F-809": {"lat": 28.5600, "lng": 77.5300, "step": 0.0018, "target": "TKD", "bearing": 330},
        }
        self.tick_count = 0
        self._update_all_ai_predictions()

    async def run_external_sync_loop(self):
        """
        Background worker that queries external RailRadar live API every 60-90s.
        Uses in-memory caching and request throttling to strictly respect API limits.
        """
        while self.running:
            for train in self.active_trains:
                if not self.running:
                    break
                t_no = train["train_no"]
                # Freight trains (F-809) are not published on public APIs; keep them simulated
                if t_no.startswith("F-"):
                    continue

                try:
                    live_data = await live_tracker.fetch_train_telemetry(t_no, STATIONS)
                    if live_data:
                        self.live_telemetry_cache[t_no] = live_data
                        train["is_live_sync"] = True
                        train["name"] = live_data.get("train_name") or train["name"]
                        train["bearing"] = live_data.get("bearing", 0.0)
                        train["segment_progress"] = live_data.get("segment_progress", 0.5)
                        train["current_delay"] = live_data.get("current_delay", train.get("default_delay", 0))
                        train["dwell_deviation"] = live_data.get("dwell_deviation", 1.5)
                        train["speed_kmh"] = live_data.get("current_speed", train.get("speed_kmh", 100))
                        train["current_section"] = live_data.get("current_section", train.get("current_section"))
                        train["current_station"] = live_data.get("current_station")
                        train["current_station_name"] = live_data.get("current_station_name")
                        train["next_station"] = live_data.get("next_station")
                        train["next_station_name"] = live_data.get("next_station_name")
                        train["journey_status"] = live_data.get("journey_status", "RUNNING")
                        train["origin_dep_time"] = live_data.get("origin_dep_time")
                        train["assigned_platform"] = live_data.get("assigned_platform", train.get("assigned_platform", 1))
                        
                        # Apply live stops and route
                        if live_data.get("stops"):
                            train["stops"] = live_data["stops"]
                            train["route"] = [s["code"] for s in live_data["stops"]]
                        
                        # Apply live calculated coordinates if available
                        if "coordinates" in live_data:
                            self.train_coords[t_no]["lat"] = live_data["coordinates"]["lat"]
                            self.train_coords[t_no]["lng"] = live_data["coordinates"]["lng"]
                            self.train_coords[t_no]["bearing"] = live_data["bearing"]
                except Exception as e:
                    print(f"[TelemetryEngine] External sync skipped for {t_no}: {e}")

                # Stagger calls by at least 2.5s between trains to prevent burst rate limits
                await asyncio.sleep(2.5)

            # Wait 60 seconds before checking for fresh updates
            await asyncio.sleep(60.0)

    def _update_all_ai_predictions(self):
        for train in self.active_trains:
            t_no = train["train_no"]
            coords = self.train_coords.get(t_no, {"lat": 28.6139, "lng": 77.2090, "bearing": 0})
            train["coordinates"] = {"lat": round(coords["lat"], 5), "lng": round(coords["lng"], 5)}
            train["bearing"] = coords.get("bearing", 0)

            live_info = self.live_telemetry_cache.get(t_no)
            
            if live_info:
                j_status = live_info.get("journey_status", "RUNNING")
                train["journey_status"] = j_status
                train["data_source"] = "LIVE_RAILRADAR"
                
                if j_status == "NOT_STARTED":
                    dep_time = live_info.get("origin_dep_time") or train.get("scheduled_departure", "--:--")
                    train["dynamic_eta"] = f"Departs {dep_time}"
                    train["predicted_delay_min"] = 0
                    train["speed_kmh"] = 0.0
                    train["expected_delay_range"] = "On Schedule"
                    train["confidence_score"] = 99.0
                    train["delay_factors"] = [{
                        "category": "Timetable Staging",
                        "impact_min": 0.0,
                        "badge": "At Origin",
                        "description": f"Train is staged at origin ({train.get('current_station_name') or train.get('source')}) awaiting departure."
                    }]
                elif j_status == "COMPLETED":
                    train["dynamic_eta"] = "Terminated"
                    train["predicted_delay_min"] = 0
                    train["speed_kmh"] = 0.0
                    train["expected_delay_range"] = "Arrived at Destination"
                    train["confidence_score"] = 100.0
                    train["delay_factors"] = [{
                        "category": "Mission Completed",
                        "impact_min": 0.0,
                        "badge": "Terminated",
                        "description": f"Train has arrived at terminal {train.get('current_station_name') or train.get('destination')} and completed journey."
                    }]
                else:
                    # RUNNING
                    headway = live_info.get("next_station_dist_km", 14.0)
                    prediction = eta_model.predict_delay_with_explanation(
                        current_delay=live_info.get("current_delay", 10.0),
                        headway_km=headway,
                        visibility_m=2000.0 if t_no == "12723" else 6000.0,
                        junction_load=0.72 if t_no == "12723" else 0.45,
                        priority=live_info.get("priority", train.get("priority", 2)),
                        dwell_deviation_min=live_info.get("dwell_deviation", 1.5),
                        scheduled_arrival=train["scheduled_arrival"],
                    )
                    train["dynamic_eta"] = prediction["dynamic_eta"]
                    train["predicted_delay_min"] = prediction["predicted_delay_min"]
                    train["expected_delay_range"] = prediction["expected_delay_range"]
                    train["confidence_score"] = prediction["confidence_score"]
                    train["delay_factors"] = prediction["delay_factors"]

            elif t_no == "12723":  # AP Express simulation preset
                train["journey_status"] = "RUNNING"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 14),
                    headway_km=4.8,
                    visibility_m=1200,
                    junction_load=0.78,
                    priority=2,
                    dwell_deviation_min=2.5,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                train["data_source"] = "HYBRID_SIMULATION"
                train["dynamic_eta"] = prediction["dynamic_eta"]
                train["predicted_delay_min"] = prediction["predicted_delay_min"]
                train["expected_delay_range"] = prediction["expected_delay_range"]
                train["confidence_score"] = prediction["confidence_score"]
                train["delay_factors"] = prediction["delay_factors"]
            elif t_no == "22436":  # Vande Bharat simulation preset
                train["journey_status"] = "RUNNING"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 2),
                    headway_km=25.0,
                    visibility_m=8000,
                    junction_load=0.25,
                    priority=1,
                    dwell_deviation_min=0.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                train["data_source"] = "HYBRID_SIMULATION"
                train["dynamic_eta"] = prediction["dynamic_eta"]
                train["predicted_delay_min"] = prediction["predicted_delay_min"]
                train["expected_delay_range"] = prediction["expected_delay_range"]
                train["confidence_score"] = prediction["confidence_score"]
                train["delay_factors"] = prediction["delay_factors"]
            elif t_no == "F-809":  # Freight simulation preset
                train["journey_status"] = "RUNNING"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 45),
                    headway_km=15.0,
                    visibility_m=2500,
                    junction_load=0.85,
                    priority=3,
                    dwell_deviation_min=5.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                train["data_source"] = "HYBRID_SIMULATION"
                train["dynamic_eta"] = prediction["dynamic_eta"]
                train["predicted_delay_min"] = prediction["predicted_delay_min"]
                train["expected_delay_range"] = prediction["expected_delay_range"]
                train["confidence_score"] = prediction["confidence_score"]
                train["delay_factors"] = prediction["delay_factors"]
            else:
                train["journey_status"] = "RUNNING"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", train.get("default_delay", 8)),
                    headway_km=14.0,
                    visibility_m=5000,
                    junction_load=0.50,
                    priority=train.get("priority", 2),
                    dwell_deviation_min=1.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                train["data_source"] = "HYBRID_SIMULATION"
                train["dynamic_eta"] = prediction["dynamic_eta"]
                train["predicted_delay_min"] = prediction["predicted_delay_min"]
                train["expected_delay_range"] = prediction["expected_delay_range"]
                train["confidence_score"] = prediction["confidence_score"]
                train["delay_factors"] = prediction["delay_factors"]

    async def register_client(self, websocket: WebSocket):
        await websocket.accept()
        self.connected_clients.add(websocket)
        # Immediately send current state
        await websocket.send_json(self.get_system_snapshot())

    def unregister_client(self, websocket: WebSocket):
        self.connected_clients.discard(websocket)

    def get_system_snapshot(self) -> Dict:
        conflicts = conflict_detector.detect_platform_conflicts(self.active_trains)
        proximity_alerts = conflict_detector.detect_proximity_alerts(self.active_trains)
        network_metrics = track_network.get_section_metrics()

        # Section average delay
        delays = [t.get("predicted_delay_min", 0) for t in self.active_trains]
        avg_delay = round(sum(delays) / len(delays), 1) if delays else 0

        tracker_status = live_tracker.get_status()
        is_live = tracker_status["live_enabled"] and tracker_status["total_api_calls_made"] > 0

        return {
            "timestamp": asyncio.get_event_loop().time(),
            "trains": self.active_trains,
            "conflicts": conflicts,
            "proximity_alerts": proximity_alerts,
            "network_metrics": network_metrics,
            "tracker_status": tracker_status,
            "data_source_mode": "LIVE_RAILRADAR" if is_live else "HYBRID_SIMULATION",
            "section_summary": {
                "active_trains_count": len(self.active_trains),
                "avg_delay_min": avg_delay,
                "congested_corridors": 2,
                "critical_headway_count": len(proximity_alerts),
                "platform_lock_count": 1,
            }
        }

    async def run_simulation_loop(self):
        """Background loop advancing train coordinates and streaming updates."""
        self.running = True
        while self.running:
            self.tick_count += 1

            # Move trains slightly along their path if running (do not move stationary not-started or completed trains)
            for t_no, pos in self.train_coords.items():
                train_obj = next((t for t in self.active_trains if t["train_no"] == t_no), None)
                j_status = train_obj.get("journey_status", "RUNNING") if train_obj else "RUNNING"

                # Stationary trains (waiting at origin or terminated at destination) stay parked
                if j_status in ["NOT_STARTED", "COMPLETED"]:
                    continue

                if t_no in self.live_telemetry_cache:
                    # In live running mode, smooth micro-interpolation
                    pos["lat"] += 0.0001
                    pos["lng"] -= 0.0001
                elif pos["target"] == "NDLS":
                    pos["lat"] += (28.6415 - pos["lat"]) * 0.008
                    pos["lng"] += (77.2194 - pos["lng"]) * 0.008
                else:
                    pos["lat"] -= 0.0012
                    pos["lng"] += 0.0015

            self._update_all_ai_predictions()
            track_network.update_block_signals(self.active_trains)

            # Broadcast to clients
            snapshot = self.get_system_snapshot()
            disconnected = set()
            for ws in self.connected_clients:
                try:
                    await ws.send_json(snapshot)
                except Exception:
                    disconnected.add(ws)

            for ws in disconnected:
                self.connected_clients.discard(ws)

            await asyncio.sleep(2.5)

    def search_trains(self, query: str = "", from_stn: str = "", to_stn: str = "") -> List[Dict]:
        results = []
        q = query.strip().lower()
        f = from_stn.strip().upper()
        t = to_stn.strip().upper()

        for train in self.active_trains:
            matches_q = not q or (q in train["train_no"].lower() or q in train["name"].lower())
            matches_route = True
            if f and t:
                route = train["route"]
                if f in route and t in route:
                    matches_route = route.index(f) < route.index(t)
                else:
                    matches_route = False
            elif f:
                matches_route = f in train["route"]
            elif t:
                matches_route = t in train["route"]

            if matches_q and matches_route:
                results.append(train)

        return results

    def get_train_by_no(self, train_no: str) -> Dict:
        for t in self.active_trains:
            if t["train_no"] == train_no:
                return t
        return None

    def update_train_platform(self, train_no: str, new_platform: int):
        for t in self.active_trains:
            if t["train_no"] == train_no:
                t["assigned_platform"] = new_platform
                t["platform_status"] = "CLEAR"
                return True
        return False


telemetry_engine = TelemetryEngine()
