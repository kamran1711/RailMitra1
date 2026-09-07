import React, { useState } from "react";
import { X, Search, Ticket, CheckCircle2, AlertCircle, Clock, Train } from "lucide-react";

export default function PnrModal({ isOpen, onClose }) {
  const [pnrNumber, setPnrNumber] = useState("4528916320");
  const [pnrData, setPnrData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSearch = async (pnrToSearch) => {
    const query = pnrToSearch || pnrNumber;
    if (!query || query.length !== 10) {
      setError("Please enter a valid 10-digit PNR number.");
      return;
    }
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`http://localhost:8080/api/pnr/${query}`);
      if (!res.ok) throw new Error("PNR not found or invalid format");
      const data = await res.json();
      setPnrData(data);
    } catch (e) {
      setError("Unable to fetch PNR status. Please verify the 10-digit number.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">IRCTC Live PNR Status Inquiry</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Bar */}
        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={10}
              value={pnrNumber}
              onChange={(e) => setPnrNumber(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter 10-Digit PNR..."
              className="flex-1 bg-slate-950 border border-slate-700 text-sm font-mono tracking-widest text-slate-100 rounded-xl px-4 py-2.5 focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <button
              onClick={() => handleSearch()}
              disabled={isLoading}
              className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5"
            >
              <Search className="w-4 h-4" />
              <span>{isLoading ? "Checking..." : "Verify PNR"}</span>
            </button>
          </div>

          {/* Quick Demo PNR Pills */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Try Sample PNR:</span>
            <button
              onClick={() => {
                setPnrNumber("4528916320");
                handleSearch("4528916320");
              }}
              className="px-2 py-0.5 rounded bg-slate-800 text-cyan-400 hover:bg-slate-700 font-mono text-[11px]"
            >
              4528916320 (AP Exp)
            </button>
            <button
              onClick={() => {
                setPnrNumber("2819405671");
                handleSearch("2819405671");
              }}
              className="px-2 py-0.5 rounded bg-slate-800 text-purple-400 hover:bg-slate-700 font-mono text-[11px]"
            >
              2819405671 (Vande Bharat)
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* PNR Response Card */}
          {pnrData && (
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 space-y-3">
              <div className="flex items-start justify-between border-b border-slate-800 pb-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold">TRAIN DETAILS</span>
                  <h4 className="font-bold text-white text-sm">
                    {pnrData.train_name} ({pnrData.train_no})
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {pnrData.from_station} ➔ {pnrData.to_station}
                  </p>
                </div>
                <div className="text-right">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    {pnrData.booking_status}
                  </span>
                  <p className="text-[10px] text-slate-400 mt-1">{pnrData.chart_status}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase">Coach</span>
                  <p className="font-bold font-mono text-cyan-400 text-sm mt-0.5">{pnrData.coach}</p>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase">Berth</span>
                  <p className="font-bold font-mono text-amber-400 text-sm mt-0.5">{pnrData.berth}</p>
                </div>
                <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 uppercase">Dynamic ETA</span>
                  <p className="font-bold font-mono text-emerald-400 text-sm mt-0.5">
                    {pnrData.live_eta || "06:44"}
                  </p>
                </div>
              </div>

              {pnrData.passengers && (
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Passenger Details</span>
                  {pnrData.passengers.map((p, i) => (
                    <div key={i} className="flex justify-between items-center text-xs text-slate-300 mt-1">
                      <span>{p.name} ({p.age}, {p.gender})</span>
                      <span className="font-mono text-cyan-300 font-bold">{p.seat} • {p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
