"""Protection, isolation, energisation and radiality."""

from __future__ import annotations

from encirra_sim.topology import check_radiality, energized_buses, plan_fault


def _bus(n: int) -> int:  # 1-based benchmark number -> pandapower index
    return n - 1


def test_fault_plan_feeder_f3(district):
    fp = plan_fault(district, 26)  # line B27–B28
    assert fp.protective_switch == "SW-06-26"
    assert fp.isolation_open == ("SW-27-28", "SW-28-29")
    assert fp.reclose == ("SW-06-26",)
    assert fp.section_buses == {_bus(28)}
    assert fp.tripped_buses == {_bus(n) for n in range(26, 34)}
    assert fp.downstream_dark == {_bus(n) for n in range(29, 34)}


def test_pump_feeder_fault_isolates_ps2_bus(district):
    fp = plan_fault(district, 31)  # PS-2 supply cable B32–B33
    assert fp.section_buses == {_bus(33)}
    assert fp.downstream_dark == frozenset()


def test_isolation_deenergises_the_right_buses(district):
    fp = plan_fault(district, 26)
    closed = list(district.normal_switch_state())
    closed[fp.protective_line] = False  # recloser trip
    en = energized_buses(district, closed, [26])
    assert not any(_bus(n) in en for n in range(26, 34))
    assert _bus(18) in en and _bus(25) in en
    for s in fp.isolation_open:
        closed[district.switch_index[s]] = False
    closed[fp.protective_line] = True  # reclose healthy upstream part
    en = energized_buses(district, closed, [26])
    assert _bus(26) in en and _bus(27) in en
    assert not any(_bus(n) in en for n in range(28, 34))


def test_tie_closure_reenergises_downstream(district):
    fp = plan_fault(district, 26)
    closed = list(district.normal_switch_state())
    for s in fp.isolation_open:
        closed[district.switch_index[s]] = False
    closed[district.switch_index["SW-25-29"]] = True
    en = energized_buses(district, closed, [26])
    assert all(_bus(n) in en for n in range(29, 34))
    assert _bus(28) not in en  # faulted section stays dark
    assert check_radiality(district, closed, [26]).radial


def test_two_ties_without_split_form_a_loop(district):
    fp = plan_fault(district, 26)
    closed = list(district.normal_switch_state())
    for s in fp.isolation_open:
        closed[district.switch_index[s]] = False
    closed[district.switch_index["SW-25-29"]] = True
    closed[district.switch_index["SW-18-33"]] = True
    rad = check_radiality(district, closed, [26])
    assert not rad.radial
    assert any({35, 36} <= set(loop) for loop in rad.loops)
    # opening a sectionalizer between the two tie points restores radiality
    closed[district.switch_index["SW-31-32"]] = False
    assert check_radiality(district, closed, [26]).radial


def test_closing_a_tie_into_an_energised_feeder_is_a_loop(district):
    closed = list(district.normal_switch_state())
    closed[district.switch_index["SW-25-29"]] = True
    rad = check_radiality(district, closed)
    assert not rad.radial and rad.loops
