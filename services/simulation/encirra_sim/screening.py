"""CP-SAT shed-set proposal under a LinDistFlow approximation (OR-Tools).

The exhaustive enumeration in recovery.py covers every shed set of up to ``MAX_SHED_BUSES`` buses
exactly (AC power flow + EPS). When a radial topology is still infeasible with every enumerated
shed set, this module asks CP-SAT for the *largest restorable load* over **all** subsets of the
sheddable buses, subject to linearised network limits at the peak-load minute:

* LinDistFlow voltage drop on the radial tree (losses neglected):
  ``v_j = v_i − 2·(r_ij·P_ij + x_ij·Q_ij) / V_base²`` with ``v = |V|²``, ``v_slack = 1``;
  constraint ``v_j ≥ (V_min + margin)²`` for every energised bus.
* Line apparent-power limit ``S_max = √3 · V_base · I_rating · 0.95`` approximated by the octagon
  ``P ≤ S_max, Q ≤ S_max, P + Q ≤ √2 · S_max`` (flows are non-negative on a radial tree of loads).

The proposal is only a candidate: it is then simulated with AC power flow and the hydraulic EPS and
must pass every hard check like any enumerated candidate. Coefficients are scaled to integers for
CP-SAT (W and W·Ω resolution); the solver is deterministic (single worker, fixed seed).
"""

from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

import networkx as nx
import pandapower.networks as pn
from ortools.sat.python import cp_model

from .config import District

_IMPEDANCE: dict[int, tuple[float, float]] = {}


def _impedance(d: District) -> dict[int, tuple[float, float]]:
    if not _IMPEDANCE:
        ref = pn.case33bw()
        for ln in d.lines:
            length = float(ref.line.at[ln.id, "length_km"])
            _IMPEDANCE[ln.id] = (float(ref.line.at[ln.id, "r_ohm_per_km"]) * length, float(ref.line.at[ln.id, "x_ohm_per_km"]) * length)
    return _IMPEDANCE


def propose_shed_set(
    d: District,
    closed: Sequence[bool],
    out_of_service: Iterable[int],
    sheddable: Sequence[int],
    load_factor: float,
    extra_kw: dict[int, tuple[float, float]],
    v_min: float,
    max_shed: int,
    v_margin: float = 0.005,
    base_kv: float = 12.66,
) -> Optional[tuple[int, ...]]:
    """Return the CP-SAT optimal shed set (sorted bus ids) or None if no subset satisfies the
    linearised limits. ``extra_kw`` maps bus → (P kW, Q kVAr) of additional load (pump motors)."""
    oos = set(out_of_service)
    g = nx.Graph()
    for ln in d.lines:
        if closed[ln.id] and ln.id not in oos:
            g.add_edge(ln.from_bus, ln.to_bus, line=ln.id)
    root = d.substation_bus
    if root not in g:
        return None
    if g.subgraph(nx.node_connected_component(g, root)).number_of_edges() != len(nx.node_connected_component(g, root)) - 1:
        return None  # LinDistFlow tree model requires a radial topology
    tree = nx.bfs_tree(g, root)
    buses = list(nx.node_connected_component(g, root))
    z = _impedance(d)
    scale = 1000.0  # kW -> W
    m = cp_model.CpModel()
    x = {b: m.NewBoolVar(f"serve_{b}") for b in sheddable if b in buses}
    p_load = {}
    q_load = {}
    for b in buses:
        bus = d.buses[b]
        p = bus.load_kw * load_factor + extra_kw.get(b, (0.0, 0.0))[0]
        q = bus.load_kvar * load_factor + extra_kw.get(b, (0.0, 0.0))[1]
        p_load[b] = int(round(p * scale))
        q_load[b] = int(round(q * scale))
    sub = {b: list(nx.descendants(tree, b)) + [b] for b in buses}

    def flow(bset, loads):
        return sum(loads[b] * (x[b] if b in x else 1) for b in bset)

    parent_line = {}
    for u, v in tree.edges():
        parent_line[v] = (u, g.edges[u, v]["line"])
    # voltage (squared, per-unit, scaled) along each path
    vscale = 10**6
    vmin_sq = int(math.floor(((v_min + v_margin) ** 2) * vscale))
    drop_expr = {root: 0}
    order = list(nx.topological_sort(tree))
    for b in order:
        if b == root:
            continue
        u, lid = parent_line[b]
        r, xx = z[lid]
        # 2(rP + xQ)/V² with P in W·1e-6 MW → coefficient per W: 2*r/(V_kv² * 1e6) (pu)
        cr = 2.0 * r / (base_kv**2 * 1e6) * vscale
        cx = 2.0 * xx / (base_kv**2 * 1e6) * vscale
        terms = [(cr * p_load[c] + cx * q_load[c], c) for c in sub[b]]
        fixed = sum(t for t, c in terms if c not in x)
        var = [(t, c) for t, c in terms if c in x]
        drop_expr[b] = drop_expr[u] + int(round(fixed)) + sum(int(round(t)) * x[c] for t, c in var)
        m.Add(vscale - drop_expr[b] >= vmin_sq)
        ln = d.lines[lid]
        s_max = math.sqrt(3.0) * base_kv * ln.rating_a * 0.95  # kVA
        s_max_w = int(math.floor(s_max * scale))
        pf_ = flow(sub[b], p_load)
        qf_ = flow(sub[b], q_load)
        m.Add(pf_ <= s_max_w)
        m.Add(qf_ <= s_max_w)
        m.Add(pf_ + qf_ <= int(math.floor(math.sqrt(2.0) * s_max_w)))
    m.Add(sum(1 - xv for xv in x.values()) <= max_shed)  # switching-operation budget
    m.Maximize(sum(p_load[b] * xv for b, xv in x.items()))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 2026
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    return tuple(sorted(b for b, xv in x.items() if solver.Value(xv) == 0))
