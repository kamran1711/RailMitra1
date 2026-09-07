"""
FastAPI REST Routes for RailFlow AI
Exposes search, live telemetry, explainable delay, PNR inquiry, and what-if simulation.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from backend.data.railway_data import STATIONS, PNR_DATABASE
from backend.simulation.telemetry_engine import telemetry_engine
from backend.services.what_if_engine import what_if_engine
from backend.services.conflict_detector import conflict_detector
from backend.simulation.track_network import track_network
from backend.models.eta_model import eta_model
from backend.services.live_tracker import live_tracker

router = APIRouter(prefix="/api")


class WhatIfRequest(BaseModel):
    train_no: str
    action_type: str = "PLATFORM_REASSIGNMENT"
    source_platform: int = 3
    target_platform: int = 4
    hold_preceding_train: bool = True


class PlatformReassignRequest(BaseModel):
    train_no: str
    target_platform: int


class PredictCustomETARequest(BaseModel):
    current_delay: float
    headway_km: float = 12.0
    visibility_m: float = 8000.0
    junction_load: float = 0.50
    priority: int = 2
    dwell_deviation_min: float = 2.0
    scheduled_arrival: str = "06:30"


@router.get("/health")
def health():
    return {"status": "online", "system": "RailFlow AI Core", "version": "1.0.0"}


@router.get("/stations")
def get_stations():
    return list(STATIONS.values())


@router.get("/trains")
def get_trains():
    return telemetry_engine.active_trains


@router.get("/trains/search")
def search_trains(
    query: Optional[str] = Query(default=""),
    from_stn: Optional[str] = Query(default=""),
    to_stn: Optional[str] = Query(default=""),
):
    return telemetry_engine.search_trains(query, from_stn, to_stn)


@router.get("/trains/{train_no}")
def get_train(train_no: str):
    train = telemetry_engine.get_train_by_no(train_no)
    if not train:
        raise HTTPException(status_code=404, detail="Train not found")
    return train


@router.get("/pnr/{pnr_number}")
def check_pnr(pnr_number: str):
    clean_pnr = pnr_number.strip()
    if clean_pnr in PNR_DATABASE:
        record = PNR_DATABASE[clean_pnr]
        # Attach dynamic ETA info for the train
        train = telemetry_engine.get_train_by_no(record["train_no"])
        if train:
            record["live_eta"] = train.get("dynamic_eta")
            record["delay_min"] = train.get("predicted_delay_min")
            record["platform_status"] = train.get("platform_status")
            record["assigned_platform"] = train.get("assigned_platform")
        return record

    # Realistic mock response if random 10-digit number is typed
    if len(clean_pnr) == 10 and clean_pnr.isdigit():
        return {
            "pnr": clean_pnr,
            "train_no": "07764",
            "train_name": "Guntur - Vijayawada MEMU Passenger",
            "journey_date": "2026-09-08",
            "from_station": "GNT (Guntur Junction)",
            "to_station": "BZA (Vijayawada Junction)",
            "booking_status": "CNF (Confirmed)",
            "coach": "GS1",
            "berth": "24 (Window)",
            "class_type": "2S (Second Sitting)",
            "chart_status": "Chart Prepared",
            "live_eta": "07:51",
            "delay_min": 6,
            "platform_status": "CLEAR",
            "assigned_platform": 1,
            "passengers": [
                {"name": "K. Ravi Teja", "age": 29, "gender": "M", "seat": "GS1-24", "status": "CNF"}
            ]
        }

    raise HTTPException(status_code=404, detail="Invalid PNR number. Please provide a 10-digit PNR.")


@router.post("/controller/what-if")
def test_what_if_scenario(req: WhatIfRequest):
    return what_if_engine.simulate_dispatch_action(
        train_no=req.train_no,
        action_type=req.action_type,
        source_platform=req.source_platform,
        target_platform=req.target_platform,
        hold_preceding_train=req.hold_preceding_train,
    )


@router.post("/controller/reassign-platform")
def reassign_platform(req: PlatformReassignRequest):
    success = telemetry_engine.update_train_platform(req.train_no, req.target_platform)
    if not success:
        raise HTTPException(status_code=404, detail="Train not found")
    return {"status": "SUCCESS", "message": f"Train {req.train_no} reassigned to Platform {req.target_platform}."}


@router.get("/controller/conflicts")
def get_conflicts():
    return {
        "platform_conflicts": conflict_detector.detect_platform_conflicts(telemetry_engine.active_trains),
        "proximity_alerts": conflict_detector.detect_proximity_alerts(telemetry_engine.active_trains),
    }


@router.get("/controller/metrics")
def get_controller_metrics():
    return {
        "snapshot": telemetry_engine.get_system_snapshot(),
        "signals": track_network.signals,
    }


@router.post("/ai/predict-custom")
def predict_custom_eta(req: PredictCustomETARequest):
    return eta_model.predict_delay_with_explanation(
        current_delay=req.current_delay,
        headway_km=req.headway_km,
        visibility_m=req.visibility_m,
        junction_load=req.junction_load,
        priority=req.priority,
        dwell_deviation_min=req.dwell_deviation_min,
        scheduled_arrival=req.scheduled_arrival,
    )


class SetApiKeyRequest(BaseModel):
    api_key: str


@router.get("/system/source")
def get_system_source():
    """Returns live tracking diagnostic metrics, rate limit status, and data mode."""
    return live_tracker.get_status()


@router.post("/system/set-api-key")
def set_api_key(req: SetApiKeyRequest):
    """Updates the active RailRadar API key dynamically."""
    live_tracker.set_api_key(req.api_key)
    return {
        "status": "SUCCESS",
        "message": "API key updated successfully",
        "live_enabled": live_tracker.live_enabled,
        "masked_key": f"{req.api_key[:4]}...{req.api_key[-4:]}" if len(req.api_key) > 8 else "Configured",
    }


@router.post("/system/trigger-sync")
async def trigger_manual_sync(train_no: Optional[str] = None):
    """Triggers an on-demand sync for a specific train or active passenger fleet."""
    target_trains = [train_no] if train_no else [t["train_no"] for t in telemetry_engine.active_trains if not t["train_no"].startswith("F-")]
    synced = []
    
    for t_no in target_trains:
        data = await live_tracker.fetch_train_telemetry(t_no, STATIONS)
        if data:
            telemetry_engine.live_telemetry_cache[t_no] = data
            synced.append(t_no)
            
    return {
        "status": "COMPLETED",
        "synced_trains": synced,
        "tracker_metrics": live_tracker.get_status(),
    }

