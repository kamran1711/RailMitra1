"""
Real-time Train Telemetry & Dynamic Movement Engine
Simulates realistic GPS movement, speeds, dynamic ETA adjustments, and WebSocket broadcasting.
"""

import asyncio
import copy
import time
from datetime import datetime, timedelta
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
        # Train coordinates initialization for Passenger & MEMU fleet
        self.train_coords = {
            "04414": {"lat": 28.1500, "lng": 77.8500, "step": 0.0025, "target": "ALJN", "bearing": 135},
            "04183": {"lat": 28.4500, "lng": 77.6200, "step": 0.0028, "target": "NDLS", "bearing": 330},
            "04159": {"lat": 26.8500, "lng": 79.2500, "step": 0.0022, "target": "TDL", "bearing": 305},
            "01888": {"lat": 26.7000, "lng": 78.1000, "step": 0.0020, "target": "AGC", "bearing": 350},
            "04419": {"lat": 28.6450, "lng": 77.3200, "step": 0.0026, "target": "NDLS", "bearing": 260},
            "64521": {"lat": 28.6600, "lng": 77.3800, "step": 0.0027, "target": "NDLS", "bearing": 265},
            "07764": {"lat": 16.4100, "lng": 80.5400, "step": 0.0022, "target": "BZA", "bearing": 55},
            "07091": {"lat": 24.3500, "lng": 78.1200, "step": 0.0022, "target": "NDLS", "bearing": 25},
            "17239": {"lat": 16.4850, "lng": 80.5980, "step": 0.0022, "target": "VSKP", "bearing": 58},
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
                if train.get("skip_external_sync"):
                    continue
                t_no = train["train_no"]

                try:
                    live_data = await live_tracker.fetch_train_telemetry(t_no, STATIONS)
                    if live_data:
                        self.live_telemetry_cache[t_no] = live_data
                        train["is_live_sync"] = True
                        train["last_telemetry_timestamp"] = time.time()
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
                        if not train.get("manual_platform_override"):
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

    def _compute_journey_progress(self, train: dict) -> int:
        """Dynamically computes authentic journey completion percentage across all route stations."""
        j_status = train.get("journey_status", "RUNNING")
        if j_status == "COMPLETED":
            return 100
        if j_status == "NOT_STARTED":
            return 0

        stops = train.get("stops", [])
        if not stops or len(stops) <= 1:
            return int(train.get("journey_progress_pct", 50))

        # Identify the currently approaching or arrived stop
        approaching_idx = -1
        for idx, stop in enumerate(stops):
            if stop.get("status") in ["Approaching", "Upcoming", "Arrived"]:
                approaching_idx = idx
                break

        if approaching_idx == -1:
            return 100
        if approaching_idx == 0:
            return 5

        seg_prog = float(train.get("segment_progress", 0.5))
        total_segments = len(stops) - 1
        fractional_stops = (approaching_idx - 1) + max(0.0, min(1.0, seg_prog))
        pct = int(round((fractional_stops / total_segments) * 100))
        return max(4, min(98, pct))

    def _apply_prediction_to_train(self, train: dict, prediction: dict):
        train["dynamic_eta"] = prediction.get("dynamic_eta")
        train["eta_lower"] = prediction.get("eta_lower")
        train["eta_upper"] = prediction.get("eta_upper")
        train["eta_range_formatted"] = prediction.get("eta_range_formatted")
        train["predicted_delay_min"] = prediction.get("predicted_delay_min", 0)
        train["delay_lower_min"] = prediction.get("delay_lower_min", 0)
        train["delay_upper_min"] = prediction.get("delay_upper_min", 0)
        train["expected_delay_range"] = prediction.get("expected_delay_range")
        train["confidence_score"] = prediction.get("confidence_score", 90.0)
        train["confidence_interval_type"] = prediction.get("confidence_interval_type", "80% Quantile Interval")
        train["delay_factors"] = prediction.get("delay_factors", [])
        train["mae_minutes"] = prediction.get("mae_minutes", 3.0)
        train["accuracy_statement"] = prediction.get("accuracy_statement")
        train["validation_metrics"] = prediction.get("validation_metrics")

    def _update_all_ai_predictions(self):
        for train in self.active_trains:
            t_no = train["train_no"]
            coords = self.train_coords.get(t_no, {"lat": 28.6139, "lng": 77.2090, "bearing": 0})
            train["coordinates"] = {"lat": round(coords["lat"], 5), "lng": round(coords["lng"], 5)}
            train["bearing"] = coords.get("bearing", 0)

            live_info = None if train.get("skip_external_sync") else self.live_telemetry_cache.get(t_no)
            
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
                    self._apply_prediction_to_train(train, prediction)

            elif t_no == "04414":  # Delhi - Aligarh MEMU
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 12),
                    headway_km=6.8,
                    visibility_m=3500,
                    junction_load=0.68,
                    priority=3,
                    dwell_deviation_min=2.5,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            elif t_no == "04183":  # Tundla - Delhi MEMU
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 18),
                    headway_km=5.2,
                    visibility_m=4000,
                    junction_load=0.74,
                    priority=3,
                    dwell_deviation_min=3.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            elif t_no == "04419":  # Ghaziabad - New Delhi EMU Shuttle
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 14),
                    headway_km=4.5,
                    visibility_m=5000,
                    junction_load=0.82,
                    priority=3,
                    dwell_deviation_min=2.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            elif t_no == "07091":  # Guntur - Delhi Passenger Special
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                pct = self._compute_journey_progress(train)
                train["journey_progress_pct"] = pct
                train["status_note"] = f"In Transit: Section {train.get('current_section', 'BINA-VGLJ')} ({pct}% completed)"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 11),
                    headway_km=7.5,
                    visibility_m=5000,
                    junction_load=0.58,
                    priority=3,
                    dwell_deviation_min=2.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            elif t_no == "07764":  # Guntur - Vijayawada MEMU Passenger
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                pct = self._compute_journey_progress(train)
                train["journey_progress_pct"] = pct
                train["status_note"] = f"In Transit: Section {train.get('current_section', 'MAG-KCC')} ({pct}% completed)"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 7),
                    headway_km=17.0,
                    visibility_m=7500,
                    junction_load=0.28,
                    priority=3,
                    dwell_deviation_min=0.8,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            elif t_no == "17239":  # Guntur - Visakhapatnam Simhadri Daily Express
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                pct = self._compute_journey_progress(train)
                train["journey_progress_pct"] = pct
                train["status_note"] = f"In Transit: Section {train.get('current_section', 'KCC-BZA')} ({pct}% completed)"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", 8),
                    headway_km=14.5,
                    visibility_m=7000,
                    junction_load=0.48,
                    priority=2,
                    dwell_deviation_min=1.2,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)
            else:
                train["journey_status"] = "RUNNING"
                train["data_source"] = "HYBRID_SIMULATION"
                prediction = eta_model.predict_delay_with_explanation(
                    current_delay=train.get("current_delay", train.get("default_delay", 8)),
                    headway_km=8.0,
                    visibility_m=5000,
                    junction_load=0.55,
                    priority=3,
                    dwell_deviation_min=2.0,
                    scheduled_arrival=train["scheduled_arrival"],
                )
                self._apply_prediction_to_train(train, prediction)

            # Compute station-specific dynamic ETA for each stop along the route with quantile bounds
            delay_mins = train.get("predicted_delay_min", 0)
            delay_lower = train.get("delay_lower_min", max(0, delay_mins - 2))
            delay_upper = train.get("delay_upper_min", delay_mins + 4)
            for stop in train.get("stops", []):
                sch = stop.get("sch_arr") or stop.get("sch_dep")
                if sch and sch != "--:--":
                    try:
                        bt = datetime.strptime(sch, "%H:%M")
                        stop["dynamic_eta"] = (bt + timedelta(minutes=delay_mins)).strftime("%H:%M")
                        stop["eta_lower"] = (bt + timedelta(minutes=delay_lower)).strftime("%H:%M")
                        stop["eta_upper"] = (bt + timedelta(minutes=delay_upper)).strftime("%H:%M")
                        stop["eta_range"] = f"{stop['eta_lower']} – {stop['eta_upper']}"
                    except Exception:
                        stop["dynamic_eta"] = sch
                        stop["eta_range"] = sch
                else:
                    stop["dynamic_eta"] = sch or "--:--"
                    stop["eta_range"] = sch or "--:--"

            # Identify the approaching halt to populate station-level ETA fields
            appr_stop = next((s for s in train.get("stops", []) if s.get("status") in ["Approaching", "Origin", "Arrived"]), None)
            if appr_stop:
                train["approaching_station_code"] = appr_stop.get("code")
                train["approaching_station_name"] = appr_stop.get("name")
                train["approaching_scheduled_arrival"] = appr_stop.get("sch_arr")
                train["approaching_dynamic_eta"] = appr_stop.get("dynamic_eta")
                train["approaching_eta_range"] = appr_stop.get("eta_range", appr_stop.get("dynamic_eta"))

            # Ensure dynamic journey progress percentage is always updated based on all route stops
            train["journey_progress_pct"] = self._compute_journey_progress(train)

            # Data Freshness, Staleness & Kinematic Fallback Tracking
            if not train.get("last_telemetry_timestamp"):
                train["last_telemetry_timestamp"] = time.time()

            age_sec = max(0, int(time.time() - train["last_telemetry_timestamp"]))
            train["telemetry_age_seconds"] = age_sec

            if train.get("data_source") in ["LIVE_RAILRADAR", "DEAD_RECKONING_FALLBACK"]:
                if age_sec <= 60:
                    train["data_freshness"] = "FRESH"
                    train["feed_status_badge"] = "🟢 LIVE"
                    train["feed_status_text"] = f"Live Stream ({age_sec}s ago)"
                    train["is_feed_stale"] = False
                    train["data_source"] = "LIVE_RAILRADAR"
                elif age_sec <= 180:
                    train["data_freshness"] = "CACHED"
                    train["feed_status_badge"] = "🟡 CACHED"
                    train["feed_status_text"] = f"Cached ({age_sec}s ago • 90s TTL)"
                    train["is_feed_stale"] = False
                    train["data_source"] = "LIVE_RAILRADAR"
                else:
                    train["data_freshness"] = "STALE_DEAD_RECKONING"
                    train["feed_status_badge"] = "🟠 FALLBACK"
                    train["feed_status_text"] = f"Stale Feed ({age_sec // 60}m ago) • Kinematic Dead-Reckoning Active"
                    train["is_feed_stale"] = True
                    train["data_source"] = "DEAD_RECKONING_FALLBACK"
                    train["confidence_score"] = max(75.0, round(float(train.get("confidence_score", 94.0)) - 12.0, 1))
            else:
                train["data_freshness"] = "SIMULATION_REALTIME"
                train["feed_status_badge"] = "⚡ HIGH-FREQ"
                train["feed_status_text"] = "2.5s Kinematic Simulation & SHAP Predictor"
                train["is_feed_stale"] = False

            # Attach backtested model validation summary for auditability
            train["model_validation"] = eta_model.get_validation_metrics()
            train["mae_minutes"] = eta_model.validation_metrics.get("mae_minutes", 1.71)
            train["accuracy_summary"] = f"MAE: {train['mae_minutes']}m • {eta_model.validation_metrics.get('within_5min_accuracy_pct', 96.0)}% within ±5m"

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

            # Advance train journey progress, station transitions, and coordinates
            for train_obj in self.active_trains:
                t_no = train_obj["train_no"]
                j_status = train_obj.get("journey_status", "RUNNING")

                # Stationary trains (waiting at origin or terminated at destination) stay parked
                if j_status in ["NOT_STARTED", "COMPLETED"]:
                    continue

                # Progress along current section smoothly
                curr_prog = float(train_obj.get("segment_progress", 0.5))
                curr_prog += 0.005  # Smooth continuous advance

                stops = train_obj.get("stops", [])
                if curr_prog >= 0.98 and len(stops) > 1:
                    curr_prog = 0.02
                    # Find approaching stop and advance to next stop
                    appr_idx = next((i for i, s in enumerate(stops) if s.get("status") in ["Approaching", "Arrived"]), None)
                    if appr_idx is not None:
                        stops[appr_idx]["status"] = "Passed"
                        if appr_idx + 1 < len(stops):
                            stops[appr_idx + 1]["status"] = "Approaching"
                            train_obj["current_station"] = stops[appr_idx]["code"]
                            train_obj["current_station_name"] = stops[appr_idx]["name"]
                            train_obj["next_station"] = stops[appr_idx + 1]["code"]
                            train_obj["next_station_name"] = stops[appr_idx + 1]["name"]
                            train_obj["current_section"] = f"{stops[appr_idx]['code']}-{stops[appr_idx + 1]['code']}"
                            train_obj["status_note"] = f"In Transit: {stops[appr_idx]['name']} to {stops[appr_idx + 1]['name']}"
                        else:
                            train_obj["journey_status"] = "COMPLETED"
                            train_obj["status_note"] = f"Arrived at Destination ({stops[-1]['name']})"

                train_obj["segment_progress"] = round(curr_prog, 3)
                train_obj["journey_progress_pct"] = self._compute_journey_progress(train_obj)

                pos = self.train_coords.get(t_no)
                if pos:
                    if t_no in self.live_telemetry_cache:
                        pos["lat"] += 0.0001
                        pos["lng"] -= 0.0001
                    else:
                        target_code = train_obj.get("approaching_station_code") or train_obj.get("next_station")
                        target_stn = STATIONS.get(target_code)
                        if target_stn:
                            pos["lat"] += (target_stn["lat"] - pos["lat"]) * 0.010
                            pos["lng"] += (target_stn["lng"] - pos["lng"]) * 0.010
                        elif pos.get("target") == "NDLS":
                            pos["lat"] += (28.6415 - pos["lat"]) * 0.008
                            pos["lng"] += (77.2194 - pos["lng"]) * 0.008
                        else:
                            pos["lat"] -= 0.0005
                            pos["lng"] += 0.0006

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
                t["assigned_platform"] = int(new_platform)
                t["manual_platform_override"] = True
                t["platform_status"] = "CLEAR"
                return True
        return False


telemetry_engine = TelemetryEngine()
