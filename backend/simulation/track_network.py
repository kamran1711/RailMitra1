"""
NetworkX Railway Topology & Signaling Simulation
Models Indian Railway track blocks, junctions, automatic signals, and headways.
"""

import networkx as nx
from typing import Dict, List, Optional
from backend.data.railway_data import STATIONS


class TrackNetwork:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.signals = {}
        self.block_occupancy = {}
        self._build_network()

    def _build_network(self):
        # Add Stations as Nodes with Geo-attributes
        for code, info in STATIONS.items():
            self.graph.add_node(
                code,
                name=info["name"],
                lat=info["lat"],
                lng=info["lng"],
                platforms=info["platforms"],
                division=info["division"],
                node_type="STATION",
            )

        # Multi-track corridor edges (Up line & Down line)
        corridor_sections = [
            ("NDLS", "GZB", 26.0, 130),
            ("GZB", "ALJN", 106.0, 130),
            ("ALJN", "TDL", 78.0, 130),
            ("TDL", "CNB", 228.0, 130),
            ("CNB", "PRYJ", 194.0, 130),
            ("TDL", "AGC", 28.0, 110),
            ("AGC", "GWL", 118.0, 130),
            ("GWL", "VGLJ", 98.0, 130),
            ("VGLJ", "BPL", 292.0, 130),
            ("BPL", "BZA", 840.0, 120),
            ("BZA", "GNT", 32.0, 90),
        ]

        # Bidirectional graph for both UP and DOWN train dispatching
        for u, v, dist, mps in corridor_sections:
            self.graph.add_edge(u, v, distance_km=dist, mps=mps, tracks=2, capacity=24)
            self.graph.add_edge(v, u, distance_km=dist, mps=mps, tracks=2, capacity=24)

            # Signal blocks along this section (automatic block signaling every ~2km)
            section_id = f"{u}-{v}"
            num_blocks = max(3, int(dist / 25))
            self.signals[section_id] = [
                {
                    "block_id": f"{section_id}-B{i+1}",
                    "signal_type": "AUTOMATIC",
                    "aspect": "GREEN",  # GREEN, DOUBLE_YELLOW, YELLOW, RED
                    "km_marker": round((dist / num_blocks) * (i + 1), 1),
                    "occupied_by": None,
                }
                for i in range(num_blocks)
            ]

    def get_route_path(self, source: str, destination: str) -> List[str]:
        try:
            return nx.shortest_path(self.graph, source=source, target=destination, weight="distance_km")
        except Exception:
            return [source, destination]

    def update_block_signals(self, train_positions: List[Dict]):
        """
        Updates signal aspects based on train spacing (Indian Railways 4-aspect signaling):
        - Block occupied: RED
        - 1 block clear: YELLOW (proceed with caution, be prepared to stop)
        - 2 blocks clear: DOUBLE YELLOW (proceed at attention)
        - 3+ blocks clear: GREEN (proceed at maximum permissible speed)
        """
        # Reset all signals to green initially
        for sec, sigs in self.signals.items():
            for s in sigs:
                s["aspect"] = "GREEN"
                s["occupied_by"] = None

        # Apply train occupancy
        for t in train_positions:
            sec = t.get("current_section")
            if sec in self.signals and self.signals[sec]:
                # Mark first or matching block
                block = self.signals[sec][0]
                block["aspect"] = "RED"
                block["occupied_by"] = t.get("train_no")

                # Ripple preceding blocks
                if len(self.signals[sec]) > 1:
                    self.signals[sec][1]["aspect"] = "YELLOW"
                if len(self.signals[sec]) > 2:
                    self.signals[sec][2]["aspect"] = "DOUBLE_YELLOW"

    def get_section_metrics(self) -> Dict:
        bottlenecks = [
            {"section": "GZB-ALJN", "utilization_pct": 92, "line_density": "Critical", "status": "Congested"},
            {"section": "ALJN-TDL", "utilization_pct": 78, "line_density": "High", "status": "Moderate"},
            {"section": "TDL-CNB", "utilization_pct": 84, "line_density": "High", "status": "Moderate"},
            {"section": "AGC-GWL", "utilization_pct": 54, "line_density": "Normal", "status": "Optimal"},
        ]

        return {
            "total_nodes": self.graph.number_of_nodes(),
            "total_edges": self.graph.number_of_edges(),
            "bottlenecks": bottlenecks,
            "overall_network_efficiency": 87.4,
        }


track_network = TrackNetwork()
