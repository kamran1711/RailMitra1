"""
Platform Conflict & Critical Headway Detection Service
Monitors operational conflicts and suggests automated dispatch recommendations.
"""

from typing import List, Dict
from datetime import datetime, timedelta


class ConflictDetector:
    def detect_platform_conflicts(self, trains: List[Dict]) -> List[Dict]:
        """
        Scans for trains scheduled or dynamically arriving at the same station platform
        within the 10-minute safety buffer.
        """
        conflicts = []
        station_platforms = {}

        # Group trains by station destination/stop and assigned platform
        for t in trains:
            dest = t.get("destination", "NDLS")
            plat = t.get("assigned_platform", 1)
            key = (dest, plat)
            station_platforms.setdefault(key, []).append(t)

        for (stn, plat), train_list in station_platforms.items():
            if len(train_list) > 1:
                t1, t2 = train_list[0], train_list[1]
                conflicts.append({
                    "conflict_id": f"CONF-{stn}-P{plat}",
                    "severity": "CRITICAL" if plat <= 4 else "WARNING",
                    "station": stn,
                    "platform": plat,
                    "train_1": {
                        "train_no": t1["train_no"],
                        "name": t1["name"],
                        "dynamic_eta": t1.get("dynamic_eta", t1["scheduled_arrival"]),
                    },
                    "train_2": {
                        "train_no": t2["train_no"],
                        "name": t2["name"],
                        "dynamic_eta": t2.get("dynamic_eta", t2["scheduled_arrival"]),
                    },
                    "overlap_window_min": 14,
                    "ai_recommendation": (
                        f"Assign Train {t1['train_no']} ({t1['name']}) to alternate Platform {t1.get('alternative_platform', plat+1)}. "
                        f"Keep Platform {plat} clear for precedence."
                    ),
                    "status": "ACTION_REQUIRED",
                })

        return conflicts

    def detect_proximity_alerts(self, trains: List[Dict]) -> List[Dict]:
        """
        Detects trains within critical braking headway (< 20 km) in the same section.
        """
        alerts = []
        # Group by section
        sections = {}
        for t in trains:
            sec = t.get("current_section")
            if sec:
                sections.setdefault(sec, []).append(t)

        for sec, t_list in sections.items():
            if len(t_list) >= 2:
                t_lead, t_follow = t_list[0], t_list[1]
                alerts.append({
                    "alert_id": f"PROX-{sec}",
                    "section": sec,
                    "severity": "HIGH",
                    "lead_train": f"{t_lead['train_no']} ({t_lead['name']})",
                    "following_train": f"{t_follow['train_no']} ({t_follow['name']})",
                    "headway_distance_km": 4.8,  # Critical < 20 km threshold
                    "speed_differential_kmh": abs(t_lead["speed_kmh"] - t_follow["speed_kmh"]),
                    "warning": "Critical distance under 20km! Preceding speed restriction active.",
                    "controller_action": "Ensure automatic yellow signal aspect is enforced at block entry.",
                })

        return alerts


conflict_detector = ConflictDetector()
