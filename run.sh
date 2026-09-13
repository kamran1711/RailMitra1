#!/bin/bash
# Rail Mitra - Start Script

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo " Starting Rail Mitra System"
echo "=========================================="

# Check Python environment
PYTHON_BIN="python3"
if [ -f "$DIR/backend/venv/bin/python" ]; then
    PYTHON_BIN="$DIR/backend/venv/bin/python"
fi

# Function to kill child processes on exit
cleanup() {
    echo ""
    echo "Shutting down Rail Mitra services..."
    kill $(jobs -p) 2>/dev/null || true
    exit
}
trap cleanup SIGINT SIGTERM EXIT

# Start backend
echo "Starting Backend on http://localhost:8080..."
$PYTHON_BIN -m uvicorn backend.main:app --host 0.0.0.0 --port 8080 --reload &

# Start frontend
echo "Starting Frontend on http://localhost:3000..."
cd "$DIR/frontend"
npm run dev -- --host 0.0.0.0 --port 3000 &

echo "=========================================="
echo " Services are running:"
echo " - Frontend: http://localhost:3000"
echo " - Backend API: http://localhost:8080"
echo " - API Docs: http://localhost:8080/docs"
echo " Press Ctrl+C to stop all services."
echo "=========================================="

wait
