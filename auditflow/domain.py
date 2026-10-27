"""Deterministic checks for a deliberately narrow, documented DBVO demo scope.
No inferred legal entitlement or general payroll certification is performed.
"""
from calendar import monthrange
from datetime import date, timedelta


class InputError(ValueError):
    pass


def iso(value):
    if not isinstance(value, str) or len(value) != 10:
        raise InputError('Datum muss YYYY-MM-DD sein.')
    try:
        return date.fromisoformat(value)
    except ValueError as e:
        raise InputError('Ungültiges Kalenderdatum: ' + value) from e


def add_months(day, months):
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def validate_scenario(s):
    start = iso(s['current']['begin'])
    if not isinstance(s.get('prior',[]),list) or len(s.get('prior',[]))>200:
        raise InputError('Maximal 200 Vorerkrankungen.')
    if s['current'].get('certified') is not None and not isinstance(s['current']['certified'],bool):
        raise InputError('Nachweisstatus muss true, false oder null sein.')
    if s['current'].get('end') and iso(s['current']['end']) < start:
        raise InputError('Aktuelle AU endet vor ihrem Beginn.')
    if s.get('report_date') and iso(s['report_date']) < start:
        raise InputError('Meldedatum liegt vor der aktuellen AU.')
    periods = sorted(s.get('prior', []), key=lambda p: p['begin'])
    previous = None
    for p in periods:
        a, b = iso(p['begin']), iso(p['end'])
        if b < a or b >= start:
            raise InputError('Vorerkrankung muss vor der aktuellen AU liegen.')
        if previous and a <= previous:
            raise InputError('Überlappende Vorerkrankungen: zuerst fachlich klären.')
        previous = b
        if p.get('certified') is not None and not isinstance(p['certified'],bool):
            raise InputError('Nachweisstatus muss true, false oder null sein.')
    return s


def check(id, status, expected, actual, path, note=''):
    return dict(requirement_id=id, status=status, expected=expected, actual=actual,
                evidence={'scenario_path': path}, note=note)


def assess(s):
    """Return independent checks; missing state and unresolved boundaries are explicit."""
    validate_scenario(s)
    start = iso(s['current']['begin'])
    prior = s.get('prior', [])
    certified = [p for p in prior if p.get('certified') is True]
    results = []
    current_cert = s['current'].get('certified')
    if current_cert is False or (prior and not certified and all(p.get('certified') is False for p in prior)) or not prior:
        state = 'fail'
    elif current_cert is None or not certified:
        state = 'not_assessable'
    else:
        state = 'pass'
    results.append(check('C1', state, 'Aktuelle und mindestens eine frühere AU attestiert',
                         {'current': current_cert, 'prior_certified': len(certified)}, 'current.certified / prior[].certified'))
    if certified:
        last = max(iso(p['end']) for p in certified)
        boundary = add_months(last, 6)
        state = 'pass' if start < boundary else 'fail'
        if start == boundary:
            state = 'not_assessable'
        results.append(check('C2', state, 'Attestierte Vorerkrankung innerhalb der bestätigten Sechsmonatsgrenze',
                             {'current_begin': str(start), 'last_end': str(last), 'calendar_boundary': str(boundary)},
                             'prior[].end', 'Exakte Sechsmonatsgrenze bleibt ohne bestätigte Auslegung offen.' if start == boundary else ''))
    else:
        results.append(check('C2', 'not_assessable' if any(p.get('certified') is None for p in prior) else 'fail',
                             'Mindestens eine geeignete Vorerkrankung', None, 'prior'))
    # Threshold uses system-side stock, not the transmitted message's periods.
    end = iso(s['current']['end']) if s['current'].get('end') else None
    notes = []
    if not end and s.get('open_end_policy') == 'reviewed_inclusive_7_days' and s.get('report_date'):
        end = iso(s['report_date']) + timedelta(days=6)
        notes.append('Explizite Demo-Zählkonvention: Meldetag plus sechs Tage; keine allgemeine Rechtsfestlegung.')
    lower = add_months(start, -12)
    unknown = any(p.get('certified') is None for p in prior)
    # Uncertified short periods followed seamlessly by certified periods need specialist review.
    if any(p.get('certified') is False and any(iso(q['begin']) == iso(p['end']) + timedelta(days=1) for q in certified) for p in prior):
        unknown = True
        notes.append('Nahtloser attestierter Anschluss an nicht attestierte Zeit: fachlich prüfen.')
    eligible = [p for p in certified if iso(p['end']) >= lower]
    if any(iso(p['begin']) <= lower <= iso(p['end']) for p in eligible):
        unknown = True
        notes.append('Zeitraum an der Zwölfmonatsgrenze: Auslegung offen.')
    if end is None or unknown:
        state, total = 'not_assessable', None
        notes.append('Enddatum/Zählkonvention oder Nachweisdaten fehlen.')
    else:
        total = sum((iso(p['end']) - max(lower, iso(p['begin']))).days + 1 for p in eligible)
        total += (end - start).days + 1
        state = 'pass' if total >= 30 else 'fail'
    results.append(check('C4', state, 'Mindestens 30 Kalendertage im Systembestand', total,
                         'prior / current / report_date', ' '.join(notes)))
    return results


def check_chain(message_periods, s):
    """Check only the gap chain and known membership, not completeness of all periods."""
    try:
        validate_scenario(s)
        values = sorted(message_periods, key=lambda p: p['begin'], reverse=True)
        if not values:
            return check('C3', 'fail', 'Mindestens eine übermittelte Vorerkrankung', [], 'message.periods')
        if values != message_periods:
            return check('C3', 'fail', 'Neueste AU zuerst', message_periods, 'message.periods')
        known = {(p['begin'], p['end']) for p in s.get('prior', [])}
        if any((p['begin'], p['end']) not in known for p in values):
            return check('C3', 'fail', 'Zeiten entsprechen dem Szenario', values, 'prior / message.periods')
        next_begin = iso(s['current']['begin'])
        exact = False
        for p in values:
            a, b = iso(p['begin']), iso(p['end'])
            if a > b or b >= next_begin:
                return check('C3', 'fail', 'Getrennte Zeiträume vor aktueller AU', values, 'message.periods')
            bound = add_months(b, 6)
            if next_begin > bound:
                return check('C3', 'fail', 'Keine Kettenlücke über sechs Kalendermonate', values, 'message.periods')
            exact |= next_begin == bound
            next_begin = a
        return check('C3', 'not_assessable' if exact else 'pass', 'Bestätigte Kettengrenzen', values,
                     'message.periods', 'Keine Aussage zur Pflicht, alle Perioden zu übertragen; exakte Grenze bleibt offen.' if exact else '')
    except (KeyError, ValueError) as e:
        raise InputError(str(e)) from e


def aggregate(results, technical=False):
    if technical:
        return 'technical_error'
    states = [r['status'] for r in results if r['status'] != 'skipped']
    if 'fail' in states:
        return 'fail'
    if not states or 'not_assessable' in states:
        return 'not_assessable'
    return 'pass'
