from __future__ import annotations

import warnings

import pytest

warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


@pytest.fixture(scope="session")
def district():
    from encirra_sim.config import load_district

    return load_district()


@pytest.fixture(scope="session")
def feeder_fault_runs():
    """All three strategies for the default Electrical Feeder Failure scenario (computed once)."""
    from encirra_sim.engine import compare

    comp, runs = compare("feeder-fault", source="live", use_cache=False)
    return comp, runs


@pytest.fixture(scope="session")
def feeder_fault_runtime(feeder_fault_runs):
    from encirra_sim.engine import get_runtime, resolve_params, scenario_definition

    params = resolve_params(scenario_definition("feeder-fault"), None)
    return get_runtime("feeder-fault", params)
