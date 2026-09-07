"""
RailFlow AI - Main Backend Server Entrypoint
Provides REST endpoints and WebSocket telemetry streaming for trains.
"""

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from backend.api.routes import router as api_router
from backend.simulation.telemetry_engine import telemetry_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Start continuous 2.5s train movement and WebSocket simulation loop
    simulation_task = asyncio.create_task(telemetry_engine.run_simulation_loop())
    # 2. Start periodic 60s external RailRadar API synchronization loop
    sync_task = asyncio.create_task(telemetry_engine.run_external_sync_loop())
    print("[RailFlow AI] Telemetry engine and external live sync loop started.")
    yield
    telemetry_engine.running = False
    simulation_task.cancel()
    sync_task.cancel()
    print("[RailFlow AI] Server shutdown completed.")


app = FastAPI(
    title="RailFlow AI Core",
    description="Dynamic ETA Prediction & Railway Traffic Intelligence System (SIH 2026)",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration to allow local Vite React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API routes
app.include_router(api_router)


@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await telemetry_engine.register_client(websocket)
    try:
        while True:
            # Keep socket alive and receive client heartbeats/requests
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        telemetry_engine.unregister_client(websocket)
    except Exception:
        telemetry_engine.unregister_client(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8080, reload=True)

