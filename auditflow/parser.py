"""Sample-specific parser. Layout inferred from supplied 2026 fixture, NOT a
validated general DTA-EEL parser. Offsets are bytes, 1-based in evidence.
"""
from datetime import datetime
from .domain import InputError

PARSER_VERSION = 'fixture-041-0.1'
BLOCKS = [('DBNA',125),('DBAN',None),('DBAL',None),('DBAE',None),('DBZA',None),
          ('DBEE',None),('DBAW',None),('DBFR',None),('DBUN',None),('DBMU',None),
          ('DBVO','variable'),('DBHE',None),('DBBE',None),('DBLT',None),('DBSF',None),
          ('DBTK',None),('DBAP',320),('DBID',80),('DBSD',120)]


def parse_date(raw):
    if raw == '00000000':
        return None
    try:
        return datetime.strptime(raw, '%Y%m%d').date().isoformat()
    except ValueError as e:
        raise InputError('Ungültiges Datumsfeld: ' + raw) from e


def parse(raw):
    if len(raw) > 2_000_000:
        raise InputError('Datei überschreitet 2 MB.')
    records = [r for r in raw.split(b'\n') if r.rstrip(b'\r')]
    records = [r[:-1] if r.endswith(b'\r') else r for r in records]
    dslw = [r for r in records if r.startswith(b'DSLW')]
    if len(dslw) != 1:
        raise InputError('Fixture-Parser erwartet genau einen DSLW-Satz.')
    line = dslw[0]
    if len(line) < 224:
        raise InputError('DSLW-Kopf abgeschnitten.')
    # latin-1 is a lossless byte view, not a claim about normative encoding.
    text = line.decode('latin-1')
    result = {'abgabegrund':text[200:202], 'datensatz_id':text[98:134],
              'flags':text[205:224], 'blocks':{}, 'byte_length':len(line),
              'parser_version':PARSER_VERSION, 'encoding':'latin-1 byte view (unconfirmed)',
              'scope':'Supplied fixture layout only; technical annex not verified.'}
    cursor = 224
    for flag, (name,length) in zip(result['flags'], BLOCKS):
        if flag not in 'JN':
            raise InputError('Ungültiges Blockkennzeichen.')
        if flag == 'N':
            continue
        if length is None:
            raise InputError('Nicht unterstützter Block: ' + name)
        if line[cursor:cursor+4] != name.encode():
            raise InputError('Blockposition stimmt nicht: ' + name)
        if length == 'variable':
            n = text[cursor+30:cursor+32]
            if not n.isdigit():
                raise InputError('ANZAHL-AU ist nicht numerisch.')
            length = 32 + int(n) * 50
        block = text[cursor:cursor+length]
        if len(block) != length:
            raise InputError('Block abgeschnitten: ' + name)
        result['blocks'][name] = {'raw':block, 'position':cursor+1, 'length':length}
        if name == 'DBVO':
            n = int(block[30:32]); periods=[]
            zero_fields = [block[13:21],block[21:22],block[22:30]]
            for i in range(n):
                part = block[32+i*50:82+i*50]
                begin,end = parse_date(part[:8]),parse_date(part[8:16])
                if begin is None or end is None:
                    raise InputError('Vorerkrankung braucht Beginn und Ende.')
                periods.append({'begin':begin,'end':end})
                zero_fields.extend([part[16:17],part[17:25],part[25:33],part[33:34],part[34:42],part[42:50]])
            result['dbvo']={'grundav':block[4], 'au_ab_ag':parse_date(block[5:13]),
                            'periods':periods,'count':n,'insurer_fields_zero':all(set(x)<= {'0'} for x in zero_fields)}
        if name == 'DBID':
            result['dbid']={'aktenzeichen_sv':block[4:24].strip(),
                            'aktenzeichen_verursacher':block[24:44].strip(),
                            'referenz_id':block[44:80].strip()}
        if name == 'DBSD':
            result['dbsd']={'datensatz_id_ur':block[4:40].strip()}
        cursor += length
    if cursor != len(line):
        raise InputError('Nicht erklärte Bytes am Satzende: ' + str(len(line)-cursor))
    return result


def mutate(raw, kind):
    """Controlled demo mutation; uses parsed offsets, never substring block search."""
    info = parse(raw)
    lines = raw.splitlines(keepends=True)
    for i,line in enumerate(lines):
        if not line.startswith(b'DSLW'):
            continue
        b=bytearray(line)
        if kind == 'wrong_id':
            b[98:134]=b'00000000-0000-4000-8000-000000000099'
        elif kind == 'wrong_azvu':
            pos=info['blocks']['DBID']['position']-1+24
            b[pos:pos+20]=b'WRONG-REFERENCE'.ljust(20)
        elif kind == 'insurer_fields':
            pos=info['blocks']['DBVO']['position']-1+21
            b[pos]=ord('1')
        elif kind == 'wrong_period':
            pos=info['blocks']['DBVO']['position']-1+32
            b[pos:pos+8]=b'20260228'
        elif kind == 'truncated':
            b=b[:-20]
        else:
            raise InputError('Unbekannte Mutation.')
        lines[i]=bytes(b)
    return b''.join(lines)
