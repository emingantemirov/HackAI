"""Construct a synthetic fixture without any original personal/contact bytes.
The layout is deliberately the limited fixture layout used by this prototype.
"""
from pathlib import Path


def build_fixture():
    header=bytearray(b' '*224)
    header[:4]=b'DSLW';header[98:134]=b'00000000-0000-4000-8000-000000000001'
    header[200:202]=b'41';header[205:224]=b'JNNNNNNNNNJNNNNNJJN'
    name=b'DBNA'+b'SYNTHETIC TEST PERSON'.ljust(121,b' ')
    periods=[('20260601','20260603'),('20260301','20260303'),('20260101','20260117'),('20251014','20251015')]
    dbvo=b'DBVO1'+b'20260611'+b'0'*17+b'04'
    for a,b in periods:dbvo+=a.encode()+b.encode()+b'0'*34
    contact=b'DBAP'+b'SYNTHETIC CONTACT - NO REAL PERSON'.ljust(316,b' ')
    reference=b'DBID'+b' '*20+b'DEMO-REFERENCE-001'.ljust(20,b' ')+b' '*36
    raw=bytes(header)+name+dbvo+contact+reference+b'\r\n'
    assert len(raw)==983
    return raw

if __name__=='__main__':
    path=Path(__file__).resolve().parents[1]/'data/sample.teel'
    path.write_bytes(build_fixture())
    print('Synthetic fixture written; no original personal/contact bytes copied.')
