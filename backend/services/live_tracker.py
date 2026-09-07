"""
RailRadar Live Train Tracking Ingestion Service with Strict Rate Limiting,
In-Memory TTL Caching, Quota Protection, and Schema Normalization.
"""

import os
import time
import asyncio
import httpx
from typing import Dict, Any, Optional
from datetime import datetime, date

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


class LiveTrainTracker:
    def __init__(self):
        self.api_key: str = os.getenv("RAILRADAR_API_KEY", "").strip()
        self.base_url: str = os.getenv("RAILRADAR_BASE_URL", "https://api.railradar.in/v1").rstrip("/")
        
        # In-memory TTL cache: {train_no: {"timestamp": float, "data": dict}}
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl_seconds: float = 90.0  # 90s TTL to preserve API quota
        
        # Strict Rate Limiting & Quota Tracker
        self.max_calls_per_minute: int = int(os.getenv("RAILRADAR_MAX_CALLS_PER_MIN", "15"))
        self.max_calls_per_day: int = int(os.getenv("RAILRADAR_MAX_CALLS_PER_DAY", "250"))
        self.min_call_interval_seconds: float = 2.0  # At least 2s spacing between HTTP requests
        
        self.last_call_timestamp: float = 0.0
        self.minute_call_timestamps: list[float] = []
        self.daily_call_count: int = 0
        self.current_tracking_date: date = date.today()
        
        # Operational Mode: "LIVE" (using active key), "SIMULATED" (fallback or test)
        self.live_enabled: bool = bool(self.api_key)
        self.last_api_status: str = "INITIALIZED" if self.api_key else "NO_API_KEY (Using Hybrid Fallback)"
        self.total_api_calls_made: int = 0
        self.total_cache_hits: int = 0

    def set_api_key(self, new_key: str):
        """Allows updating the API key dynamically from settings or API."""
        self.api_key = new_key.strip()
        self.live_enabled = bool(self.api_key)
        self.last_api_status = "KEY_UPDATED" if self.live_enabled else "KEY_CLEARED"

    def get_status(self) -> Dict[str, Any]:
        """Returns diagnostic metrics for rate limits and tracking mode."""
        self._reset_daily_quota_if_needed()
        now = time.time()
        # Clean minute bucket
        self.minute_call_timestamps = [t for t in self.minute_call_timestamps if now - t < 60.0]
        
        return {
            "live_enabled": self.live_enabled,
            "has_api_key": bool(self.api_key),
            "masked_key": f"{self.api_key[:4]}...{self.api_key[-4:]}" if len(self.api_key) > 8 else ("Set" if self.api_key else "Not Set"),
            "base_url": self.base_url,
            "cache_ttl_seconds": self.cache_ttl_seconds,
            "cached_trains": list(self.cache.keys()),
            "calls_made_this_minute": len(self.minute_call_timestamps),
            "max_calls_per_minute": self.max_calls_per_minute,
            "daily_call_count": self.daily_call_count,
            "max_calls_per_day": self.max_calls_per_day,
            "total_api_calls_made": self.total_api_calls_made,
            "total_cache_hits": self.total_cache_hits,
            "last_api_status": self.last_api_status,
        }

    def _reset_daily_quota_if_needed(self):
        today = date.today()
        if today != self.current_tracking_date:
            self.daily_call_count = 0
            self.current_tracking_date = today

    def _can_make_api_call(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "NO_API_KEY"
        
        self._reset_daily_quota_if_needed()
        now = time.time()
        
        # Check daily quota
        if self.daily_call_count >= self.max_calls_per_day:
            return False, f"DAILY_LIMIT_REACHED ({self.daily_call_count}/{self.max_calls_per_day})"
        
        # Check per-minute quota
        self.minute_call_timestamps = [t for t in self.minute_call_timestamps if now - t < 60.0]
        if len(self.minute_call_timestamps) >= self.max_calls_per_minute:
            return False, f"PER_MINUTE_LIMIT_REACHED ({len(self.minute_call_timestamps)}/{self.max_calls_per_minute})"
        
        # Enforce minimum spacing
        if (now - self.last_call_timestamp) < self.min_call_interval_seconds:
            return False, "THROTTLED_SPACING"
        
        return True, "ALLOWED"

    async def fetch_train_telemetry(self, train_no: str, stations_db: dict) -> Optional[Dict[str, Any]]:
        """
        Retrieves real-time train telemetry either from:
        1. In-memory TTL cache (if fresh)
        2. RailRadar live API (if key available and limits permit)
        3. High-fidelity synthetic fallback (if offline or rate limited)
        """
        now = time.time()
        
        # 1. Check TTL Cache
        cached = self.cache.get(train_no)
        if cached and (now - cached["timestamp"]) < self.cache_ttl_seconds:
            self.total_cache_hits += 1
            return cached["data"]
        
        # 2. Check if we can make an external API call
        can_call, reason = self._can_make_api_call()
        if can_call:
            try:
                # Add rate spacing sleep if needed
                time_since_last = now - self.last_call_timestamp
                if time_since_last < self.min_call_interval_seconds:
                    await asyncio.sleep(self.min_call_interval_seconds - time_since_last)
                
                async with httpx.AsyncClient(timeout=8.0) as client:
                    headers = {
                        "Authorization": f"Bearer {self.api_key}",
                        "X-API-Key": self.api_key,
                        "Accept": "application/json",
                    }
                    
                    url = f"{self.base_url}/trains/{train_no}/live"
                    response = await client.get(url, headers=headers)
                    
                    self.last_call_timestamp = time.time()
                    self.minute_call_timestamps.append(self.last_call_timestamp)
                    self.daily_call_count += 1
                    self.total_api_calls_made += 1
                    
                    if response.status_code == 200:
                        raw_json = response.json()
                        parsed = self._normalize_railradar_payload(raw_json, stations_db)
                        self.cache[train_no] = {"timestamp": time.time(), "data": parsed}
                        self.last_api_status = f"SUCCESS (HTTP 200 at {datetime.now().strftime('%H:%M:%S')})"
                        return parsed
                    elif response.status_code == 429:
                        self.last_api_status = f"RATE_LIMITED_429 (Switching to cache/fallback)"
                        print(f"[LiveTracker] Rate limit reached on RailRadar for train {train_no}")
                    else:
                        self.last_api_status = f"HTTP_{response.status_code}: {response.text[:80]}"
                        print(f"[LiveTracker] API returned status {response.status_code} for train {train_no}")
            except Exception as e:
                self.last_api_status = f"CONNECTION_ERROR: {str(e)[:80]}"
                print(f"[LiveTracker] Error querying external API for train {train_no}: {e}")
        else:
            self.last_api_status = f"FALLBACK_ACTIVE: {reason}"
        
        # If cache exists (even if slightly expired), return it
        if cached:
            return cached["data"]
            
        # Return None so caller uses simulated baseline
        return None

    def _normalize_railradar_payload(self, raw_json: Dict[str, Any], stations_db: dict) -> Dict[str, Any]:
        """
        Parses the RailRadar schema into standardized RailFlow AI operational fields.
        Correctly unnests raw_json['data'] and extracts:
        - currentLocation (stationCode, stationName, sequence)
        - nextHalt (next approaching commercial stop)
        - next immediate block station
        - route commercial halts list with real scheduled arrival times and statuses
        """
        # Unnest data payload if wrapped in API response envelope
        data = raw_json.get("data", raw_json) if isinstance(raw_json, dict) else {}
        
        train_num = str(data.get("trainNumber", data.get("number", "")))
        train_name = data.get("trainName", data.get("train", {}).get("name", ""))
        
        # 1. Current Kinematic Location
        curr_loc = data.get("currentLocation", {})
        curr_station_code = curr_loc.get("stationCode", "")
        curr_station_name = curr_loc.get("stationName", "")
        curr_seq = int(curr_loc.get("sequence", 0))
        segment_progress = float(curr_loc.get("segmentProgress", 0.5))
        segment_progress = max(0.0, min(1.0, segment_progress))
        
        # 2. Lifecycle & Journey Status Detection
        raw_status = (data.get("status") or "").strip().lower()
        next_halt = data.get("nextHalt") or {}
        prev_halt = data.get("previousHalt") or {}
        
        if raw_status in ["completed", "terminated", "arrived"] or (not next_halt and curr_loc.get("isHalt")):
            journey_status = "COMPLETED"
        elif raw_status in ["not-started", "scheduled", "ready"] or (curr_seq <= 1 and curr_loc.get("distanceFromOriginKm", 0) == 0 and not prev_halt):
            journey_status = "NOT_STARTED"
        else:
            journey_status = "RUNNING"

        # 3. Next Approaching Station & Immediate Block
        next_halt_code = next_halt.get("stationCode", "") if next_halt else ""
        next_halt_name = next_halt.get("stationName", "") if next_halt else ""
        
        prev_halt_code = prev_halt.get("stationCode", "") if prev_halt else ""
        prev_halt_name = prev_halt.get("stationName", "") if prev_halt else ""
        
        route = data.get("route", []) or []
        next_imm_stop = next((s for s in route if s.get("sequence") == curr_seq + 1), {})
        next_imm_code = next_imm_stop.get("stationCode", "")
        next_imm_name = next_imm_stop.get("stationName", "")

        # Origin departure time
        origin_dep_time = "--:--"
        if route and route[0].get("scheduledDeparture"):
            raw_orig_dep = str(route[0].get("scheduledDeparture"))
            origin_dep_time = raw_orig_dep.split("T")[1][:5] if "T" in raw_orig_dep else raw_orig_dep[:5]

        # Station names and sections based on lifecycle status
        if journey_status == "COMPLETED":
            effective_next_code = curr_station_code
            effective_next_name = f"{curr_station_name} (Destination Reached)"
            section_name = f"Terminated at {curr_station_name}"
            current_speed = 0.0
        elif journey_status == "NOT_STARTED":
            effective_next_code = next_halt_code or next_imm_code or "FIRST_HALT"
            effective_next_name = f"{next_halt_name or next_imm_name} (First Halt)"
            section_name = f"At {curr_station_name} • Departs {origin_dep_time}"
            current_speed = 0.0
        else:
            effective_next_code = next_halt_code or next_imm_code or "NEXT"
            effective_next_name = next_halt_name or next_imm_name or effective_next_code
            section_name = f"{curr_station_code}-{effective_next_code}"
            current_speed = float(curr_loc.get("speed_kmh", data.get("train", {}).get("avgSpeed", 85.0)))
        
        # 4. Formatted Halts Timeline with Accurate Lifecycle Statuses
        stops = []
        commercial_halts = [s for s in route if s.get("isHalt")]
        total_halts_count = len(commercial_halts)

        for idx, s in enumerate(commercial_halts):
            seq = int(s.get("sequence", 0))
            st_code = s.get("stationCode", "")
            st_name = s.get("stationName", "")
            
            raw_sch = s.get("scheduledArrival") or s.get("scheduledDeparture") or ""
            time_str = "--:--"
            if "T" in str(raw_sch):
                try:
                    time_str = str(raw_sch).split("T")[1][:5]
                except Exception:
                    time_str = "--:--"
            elif raw_sch:
                time_str = str(raw_sch)[:5]

            # Determine stop status based on lifecycle
            if journey_status == "COMPLETED":
                st_status = "Arrived" if idx == total_halts_count - 1 else "Passed"
            elif journey_status == "NOT_STARTED":
                st_status = "Origin" if idx == 0 else "Upcoming"
            else:
                if seq < curr_seq:
                    st_status = "Passed"
                elif st_code == next_halt_code or (seq >= curr_seq and not any(h["status"] == "Approaching" for h in stops)):
                    st_status = "Approaching"
                else:
                    st_status = "Upcoming"

            stops.append({
                "code": st_code,
                "name": st_name,
                "sch_arr": time_str,
                "sch_dep": time_str,
                "platform": s.get("platform") or 1,
                "status": st_status,
                "distance_km": s.get("distance", 0),
            })
        
        approaching_stop = next((s for s in stops if s["status"] in ["Approaching", "Origin", "Arrived"]), None)
        assigned_platform = approaching_stop["platform"] if approaching_stop else 1
        
        bearing = float(data.get("bearing", curr_loc.get("bearing", 0.0)))
        current_delay = float(data.get("delayMinutes", curr_loc.get("delayMinutes", 0.0))) if journey_status != "NOT_STARTED" else 0.0
        max_speed = float(data.get("train", {}).get("maxSpeed", 130.0))
        
        next_dist = float(curr_loc.get("distanceFromLastStationKm", 14.0))
        if next_halt and next_halt.get("distance") and curr_loc.get("distanceFromOriginKm"):
            next_dist = max(0.0, round(float(next_halt["distance"]) - float(curr_loc["distanceFromOriginKm"]), 1))
        elif journey_status == "COMPLETED":
            next_dist = 0.0
            
        train_type_str = (data.get("train", {}).get("type") or data.get("trainType") or "EXPRESS").upper()
        if "VANDE" in train_type_str or "RAJDHANI" in train_type_str:
            priority = 1
        elif "SUPERFAST" in train_type_str or "EXPRESS" in train_type_str:
            priority = 2
        else:
            priority = 3
            
        return {
            "train_no": train_num,
            "train_name": train_name,
            "train_type": train_type_str.title(),
            "priority": priority,
            "journey_status": journey_status,
            "current_station": curr_station_code,
            "current_station_name": curr_station_name,
            "previous_station": prev_halt_code,
            "previous_station_name": prev_halt_name,
            "next_station": effective_next_code,
            "next_station_name": effective_next_name,
            "current_section": section_name,
            "origin_dep_time": origin_dep_time,
            "segment_progress": segment_progress if journey_status == "RUNNING" else (1.0 if journey_status == "COMPLETED" else 0.0),
            "bearing": bearing,
            "current_speed": current_speed,
            "max_speed_kmh": max_speed,
            "next_station_dist_km": next_dist,
            "current_delay": current_delay,
            "dwell_deviation": 1.5 if journey_status == "RUNNING" else 0.0,
            "assigned_platform": assigned_platform,
            "stops": stops,
            "source": "RAILRADAR_API",
            "last_synced": datetime.now().strftime("%H:%M:%S"),
        }


# Global singleton instance
live_tracker = LiveTrainTracker()
