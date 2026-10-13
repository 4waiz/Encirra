"""Guards key parity between packages/shared/src/contract.ts and the Pydantic models."""

from __future__ import annotations

import re

import pytest

from encirra_sim import models as M
from encirra_sim.config import repo_root


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def _block(src: str, start: int) -> tuple[str, int]:
    """Body of the brace block whose '{' is at ``start``; returns (body, index after '}')."""
    depth = 0
    for i in range(start, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[start + 1 : i], i + 1
    raise ValueError("unbalanced braces")


def _members(body: str) -> dict[str, str]:
    """Top-level ``name?: type`` members of an object-type body → {name: type}."""
    out: dict[str, str] = {}
    depth = 0
    tok = ""
    parts = []
    for ch in body:
        if ch in "{([<":
            depth += 1
        elif ch in "})]>":
            depth -= 1
        if depth == 0 and ch in ";\n":
            parts.append(tok)
            tok = ""
        else:
            tok += ch
    parts.append(tok)
    for p in parts:
        m = re.match(r"\s*([A-Za-z_]\w*)\??\s*:\s*(.*)$", p, flags=re.S)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def _interfaces() -> dict[str, dict[str, str]]:
    src = _strip_comments((repo_root() / "packages" / "shared" / "src" / "contract.ts").read_text(encoding="utf-8"))
    out = {}
    for m in re.finditer(r"export interface (\w+)\s*\{", src):
        body, _ = _block(src, m.end() - 1)
        out[m.group(1)] = _members(body)
    return out


def _inline(type_text: str) -> dict[str, str]:
    i = type_text.index("{")
    body, _ = _block(type_text, i)
    return _members(body)


def _aliases(model) -> set[str]:
    return {f.serialization_alias or f.alias or name for name, f in model.model_fields.items()}


INTERFACES = _interfaces()

MODEL_FOR = {
    "BusInfo": M.BusInfo,
    "LineInfo": M.LineInfo,
    "SwitchInfo": M.SwitchInfo,
    "FeederInfo": M.FeederInfo,
    "ElectricalTopology": M.ElectricalTopology,
    "JunctionInfo": M.JunctionInfo,
    "ReservoirInfo": M.ReservoirInfo,
    "TankInfo": M.TankInfo,
    "PipeInfo": M.PipeInfo,
    "PumpInfo": M.PumpInfo,
    "WaterTopology": M.WaterTopology,
    "FacilityInfo": M.FacilityInfo,
    "NetworkTopology": M.NetworkTopology,
    "ScenarioParams": M.ScenarioParams,
    "ScenarioDefinition": M.ScenarioDefinition,
    "ObjectiveWeights": M.ObjectiveWeights,
    "RunRequest": M.RunRequest,
    "PowerFrame": M.PowerFrame,
    "WaterFrame": M.WaterFrame,
    "FacilityState": M.FacilityState,
    "Frame": M.Frame,
    "SimEvent": M.SimEvent,
    "TimelineStep": M.TimelineStep,
    "SwitchAction": M.SwitchAction,
    "VerificationCheck": M.VerificationCheck,
    "VerificationReport": M.VerificationReport,
    "ScoreBreakdown": M.ScoreBreakdown,
    "CandidateMetrics": M.CandidateMetrics,
    "CandidateEvaluation": M.CandidateEvaluation,
    "RecoveryPlan": M.RecoveryPlan,
    "Provenance": M.Provenance,
    "RunSummary": M.RunSummary,
    "RunResult": M.RunResult,
    "Comparison": M.Comparison,
    "ReplayManifest": M.ReplayManifest,
    "HealthResponse": M.HealthResponse,
}

INLINE = [
    ("ElectricalTopology", "limits", M.ElectricalLimits),
    ("NetworkTopology", "district", M.DistrictInfo),
    ("FacilityInfo", "backup", M.FacilityBackup),
    ("SimEvent", "refs", M.EventRefs),
    ("RunResult", "timebase", M.Timebase),
    ("RecoveryPlan", "unservedAfter", M.UnservedAfter),
    ("ReplayManifest", "scenarios", M.ManifestScenario),
    ("ScenarioDefinition", "faultOptions", M.FaultOption),
]


def test_contract_parsed():
    assert len(INTERFACES) >= 36
    assert set(MODEL_FOR) <= set(INTERFACES), set(MODEL_FOR) - set(INTERFACES)


def test_every_interface_has_a_model():
    assert set(INTERFACES) == set(MODEL_FOR), f"unmapped interfaces: {set(INTERFACES) - set(MODEL_FOR)}"


@pytest.mark.parametrize("name", sorted(MODEL_FOR))
def test_interface_key_parity(name):
    ts = set(INTERFACES[name])
    py = _aliases(MODEL_FOR[name])
    assert ts == py, f"{name}: missing in Python {ts - py}, extra in Python {py - ts}"


@pytest.mark.parametrize("iface,member,model", INLINE)
def test_inline_object_parity(iface, member, model):
    ts = set(_inline(INTERFACES[iface][member]))
    assert ts == _aliases(model), f"{iface}.{member}: {ts ^ _aliases(model)}"


def test_record_keys_are_strategy_ids():
    for model in (M.StrategySummaries, M.StrategyPlans, M.StrategyRuns):
        assert _aliases(model) == {"none", "grid-only", "encirra"}


def test_union_literals_match_contract():
    src = _strip_comments((repo_root() / "packages" / "shared" / "src" / "contract.ts").read_text(encoding="utf-8"))

    def union(name):
        m = re.search(rf"export type {name}\s*=\s*([^;]+);", src, flags=re.S)
        return set(re.findall(r"'([^']+)'", m.group(1)))

    from typing import get_args

    assert union("StageId") == set(get_args(M.StageId))
    assert union("ScenarioId") == set(get_args(M.ScenarioId))
    assert union("StrategyId") == set(get_args(M.StrategyId))
    assert union("ElementState") == set(get_args(M.ElementState))
    assert union("EventKind") == set(get_args(M.EventKind))
    assert union("FacilityPower") == set(get_args(M.FacilityPower))
    assert union("FacilityWater") == set(get_args(M.FacilityWater))
    assert union("FacilityStatus") == set(get_args(M.FacilityStatus))
    assert union("TimelineStepId") == set(get_args(M.TimelineStepId))
