"""Analytical expectations for authored synthetic templates, NOT a legal oracle.
Does not import the target simulator or the old DBVO checker.
"""
from datetime import date
from calendar import monthrange


def expectation(facts, rules):
    """Facts are produced by the controlled generator and validated against profiles.
    Separate result per criterion is retained even where another criterion rejects.
    """
    checks={}
    c=rules['C1']['params']
    checks['C1']=(facts['current_certified'] or not c['require_current']) and (facts['prior_certified'] or not c['require_prior'])
    start=date.fromisoformat(facts['current_begin']);last=date.fromisoformat(facts['prior_end'])
    months=rules['C2']['params']['months']
    year=last.year+(last.month-1+months)//12
    month=(last.month-1+months)%12+1
    day=min(last.day,monthrange(year,month)[1])
    comparison=(start.year,start.month,start.day) < (year,month,day)
    equal=(start.year,start.month,start.day)==(year,month,day)
    policy=rules['C2']['params']['exact_boundary']
    checks['C2']=None if equal and policy=='unresolved' else (policy=='inclusive' if equal else comparison)
    checks['C4']=None if facts['total_certified_days'] is None else facts['total_certified_days']>=rules['C4']['params']['days']
    # Known false prerequisites are sufficient for no message even with another unknown.
    message=False if any(x is False for x in checks.values()) else None if any(x is None for x in checks.values()) else True
    return {'message_present':message,'checks':checks,'provenance':'analytical synthetic-template expectation; not legal validation'}
