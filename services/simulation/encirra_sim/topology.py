"""Graph utilities for the switched 33-bus network (NetworkX).

* Energisation: a bus is energised when a path of closed, in-service lines connects it to the
  substation (pandapower ext_grid bus).
* Radiality: the energised subgraph must be a tree (|E| = |V| − 1, no loops).
* Protection follows the normal radial orientation (BFS from the substation over normally-closed
  lines): the first recloser/breaker upstream of the fault trips.
* Isolation uses the branch-switch abstraction common in distribution-reconfiguration studies on
  this benchmark: every line section has a load-break switch and opening it takes that section out
  of service. A faulted line with a remote switch is isolated by that switch alone (its end buses
  stay healthy and can be re-supplied); with a manual switch the isolated section extends through
  manual switches to the nearest remote ones.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import networkx as nx

from .config import District


def closed_graph(district: District, closed: Sequence[bool], out_of_service: Iterable[int] = ()) -> nx.MultiGraph:
    oos = set(out_of_service)
    g = nx.MultiGraph()
    g.add_nodes_from(range(district.n_bus))
    for ln in district.lines:
        if closed[ln.id] and ln.id not in oos:
            g.add_edge(ln.from_bus, ln.to_bus, key=ln.id, line=ln.id)
    return g


def energized_buses(district: District, closed: Sequence[bool], out_of_service: Iterable[int] = ()) -> frozenset[int]:
    g = closed_graph(district, closed, out_of_service)
    return frozenset(nx.node_connected_component(g, district.substation_bus))


@dataclass(frozen=True)
class RadialityResult:
    radial: bool
    loops: tuple[tuple[int, ...], ...]  # line ids forming each independent loop
    detail: str


def check_radiality(district: District, closed: Sequence[bool], out_of_service: Iterable[int] = ()) -> RadialityResult:
    """The energised component must be a tree. Loops are reported by the line ids in each cycle."""
    g = closed_graph(district, closed, out_of_service)
    comp = nx.node_connected_component(g, district.substation_bus)
    sub = g.subgraph(comp)
    n_edges = sub.number_of_edges()
    if n_edges == len(comp) - 1:
        return RadialityResult(True, (), f"{len(comp)} energised buses, {n_edges} closed lines (tree)")
    simple = nx.Graph()
    for u, v, data in sub.edges(data=True):
        simple.add_edge(u, v, line=data["line"])
    loops = []
    for cyc in nx.cycle_basis(simple):
        ids = []
        for i in range(len(cyc)):
            a, b = cyc[i], cyc[(i + 1) % len(cyc)]
            ids.append(simple.edges[a, b]["line"])
        loops.append(tuple(sorted(ids)))
    loops.sort()
    return RadialityResult(False, tuple(loops), f"{n_edges} closed lines among {len(comp)} energised buses ({n_edges - len(comp) + 1} loop(s))")


@dataclass(frozen=True)
class RadialTree:
    parent_line: dict[int, int]  # bus -> line feeding it (normal configuration)
    parent_bus: dict[int, int]
    children: dict[int, tuple[int, ...]]  # bus -> child lines
    depth: dict[int, int]


def normal_tree(district: District) -> RadialTree:
    closed = district.normal_switch_state()
    parent_line: dict[int, int] = {}
    parent_bus: dict[int, int] = {}
    depth = {district.substation_bus: 0}
    children: dict[int, list[int]] = {b: [] for b in range(district.n_bus)}
    adj: dict[int, list[tuple[int, int]]] = {b: [] for b in range(district.n_bus)}
    for ln in district.lines:
        if closed[ln.id]:
            adj[ln.from_bus].append((ln.to_bus, ln.id))
            adj[ln.to_bus].append((ln.from_bus, ln.id))
    queue = [district.substation_bus]
    seen = {district.substation_bus}
    while queue:
        b = queue.pop(0)
        for nb, lid in sorted(adj[b], key=lambda x: x[1]):
            if nb in seen:
                continue
            seen.add(nb)
            parent_line[nb] = lid
            parent_bus[nb] = b
            depth[nb] = depth[b] + 1
            children[b].append(lid)
            queue.append(nb)
    return RadialTree(parent_line, parent_bus, {k: tuple(v) for k, v in children.items()}, depth)


def downstream_of_line(district: District, line_id: int, tree: RadialTree | None = None) -> set[int]:
    """Buses below ``line_id`` in the normal radial configuration (including its downstream bus)."""
    tree = tree or normal_tree(district)
    ln = district.lines[line_id]
    start = ln.to_bus if tree.parent_line.get(ln.to_bus) == line_id else ln.from_bus
    out = {start}
    stack = [start]
    while stack:
        b = stack.pop()
        for lid in tree.children[b]:
            child = district.lines[lid].to_bus if district.lines[lid].from_bus == b else district.lines[lid].from_bus
            if child not in out:
                out.add(child)
                stack.append(child)
    return out


def path_lines_to_substation(district: District, bus: int, tree: RadialTree | None = None) -> list[int]:
    """Lines from ``bus`` up to the substation (closest first)."""
    tree = tree or normal_tree(district)
    out = []
    b = bus
    while b in tree.parent_line:
        out.append(tree.parent_line[b])
        b = tree.parent_bus[b]
    return out


@dataclass(frozen=True)
class FaultPlan:
    fault_line: int
    protective_switch: str  # recloser/breaker that trips
    protective_line: int
    tripped_buses: frozenset[int]  # de-energised by the protection operation
    section_buses: frozenset[int]  # buses inside the isolated faulted section
    section_lines: frozenset[int]
    isolation_open: tuple[str, ...]  # switches opened to isolate the section (remote)
    reclose: tuple[str, ...]  # protective device reclosed after isolation (if healthy upstream exists)
    downstream_dark: frozenset[int]  # healthy buses left de-energised after isolation (restorable)
    feeder: str


def plan_fault(district: District, fault_line: int) -> FaultPlan:
    tree = normal_tree(district)
    ln = district.lines[fault_line]
    if ln.kind != "feeder":
        raise ValueError(f"Line {fault_line} is a normally-open tie and cannot be the faulted section")
    # Protection: first recloser/breaker on the path from the faulted line up to the substation.
    up_lines = [fault_line] + path_lines_to_substation(district, ln.from_bus, tree)
    prot = None
    for lid in up_lines:
        if district.lines[lid].switch_kind in ("recloser", "breaker"):
            prot = lid
            break
    if prot is None:
        raise ValueError("No protective device upstream of the faulted line")
    tripped = frozenset(downstream_of_line(district, prot, tree))

    # Isolation (branch-switch abstraction of the reconfiguration literature): opening a line's
    # remote switch takes that line section out of service, so a faulted line with a remote switch is
    # isolated by its own switch and no bus is lost with it. If the faulted line's switch is not
    # remotely operable, the fault stays connected to both end buses; the isolated section then grows
    # through closed non-remote switches until remote switches bound it on every side.
    section_lines = {fault_line}
    section_buses: set[int] = set()
    open_sw: list[str] = []
    normal = district.normal_switch_state()
    if ln.remote:
        open_sw.append(ln.switch_id)
    else:
        stack = [ln.from_bus, ln.to_bus]
        while stack:
            b = stack.pop()
            if b in section_buses:
                continue
            section_buses.add(b)
            for other in district.lines:
                if other.id in section_lines or not normal[other.id] or b not in (other.from_bus, other.to_bus):
                    continue
                if other.remote:
                    open_sw.append(other.switch_id)
                else:
                    section_lines.add(other.id)
                    stack.append(other.to_bus if other.from_bus == b else other.from_bus)
        if district.substation_bus in section_buses:
            raise ValueError("The faulted section cannot be isolated from the substation with remote switches")
    prot_sw = district.lines[prot].switch_id
    reclose: tuple[str, ...] = ()
    if prot_sw not in open_sw and prot not in section_lines:
        reclose = (prot_sw,)
    open_sw = sorted(set(open_sw), key=lambda s: district.switch_index[s])
    # buses healthy but left dark after isolation = tripped − section − (re-energised by reclosing)
    closed = list(district.normal_switch_state())
    for s in open_sw:
        closed[district.switch_index[s]] = False
    if not reclose:
        closed[prot] = False
    en = energized_buses(district, closed, out_of_service=[fault_line])
    dark = frozenset(b for b in tripped if b not in en and b not in section_buses)
    return FaultPlan(
        fault_line=fault_line,
        protective_switch=prot_sw,
        protective_line=prot,
        tripped_buses=tripped,
        section_buses=frozenset(section_buses),
        section_lines=frozenset(section_lines),
        isolation_open=tuple(open_sw),
        reclose=reclose,
        downstream_dark=dark,
        feeder=ln.feeder,
    )
