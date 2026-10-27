"""Standalone mock vendor. It deliberately does not call automation_reference.
Actual software output is supported separately via JSON import.
"""
from datetime import date,timedelta
from .domain import add_months


def execute(profile,rules,behavior='healthy'):
    s=profile['scenario'];current=s['current'];prior=s['prior']
    certified=[p for p in prior if p.get('certified') is True]
    if behavior=='always_send':return {'message_present':True}
    config=rules['C1']['params']
    proof=(current['certified'] or not config['require_current']) and (bool(certified) or not config['require_prior'])
    if behavior=='ignore_certificate':proof=True
    start=date.fromisoformat(current['begin'])
    # Gap is taken from the last stored prior date; C1 independently controls proof.
    last=max(date.fromisoformat(p['end']) for p in prior)
    boundary=add_months(last,rules['C2']['params']['months'])
    within=start<boundary
    if start==boundary:
        p=rules['C2']['params']['exact_boundary']
        within=None if p=='unresolved' else p=='inclusive'
    total=None
    if current.get('end'):
        total=(date.fromisoformat(current['end'])-start).days+1
        for p in certified:
            total+=(date.fromisoformat(p['end'])-date.fromisoformat(p['begin'])).days+1
    threshold=30 if behavior=='outdated_threshold' else rules['C4']['params']['days']
    enough=None if total is None else total>=threshold
    decisions=[proof,within,enough]
    result=False if any(x is False for x in decisions) else None if any(x is None for x in decisions) else True
    return {'message_present':result}
