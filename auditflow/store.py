import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self,path,seed):
        self.path=str(path); self.lock=threading.RLock()
        Path(path).parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS items(kind TEXT,id TEXT,data TEXT,PRIMARY KEY(kind,id))')
            db.execute('CREATE TABLE IF NOT EXISTS document_files(sha TEXT PRIMARY KEY,data BLOB NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,action TEXT,data TEXT,prev TEXT,hash TEXT)')
        with self.lock:
            if not self.list('document'):
                for kind,key in [('document','documents'),('requirement','requirements'),('case','cases')]:
                    for item in seed[key]:self.put(kind,item)
                self.put('meta',{'id':'chain','steps':seed['chain']})
                self.event('seed',{'note':'All substantive approvals pending.'})

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path, timeout=20)
        try:
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def list(self,kind):
        with self.connect() as db:
            return [json.loads(r[0]) for r in db.execute('SELECT data FROM items WHERE kind=? ORDER BY rowid',(kind,))]

    def get(self,kind,id):
        with self.connect() as db:
            row=db.execute('SELECT data FROM items WHERE kind=? AND id=?',(kind,id)).fetchone()
        if row is None: raise KeyError(id)
        return json.loads(row[0])

    def put(self,kind,item):
        with self.lock,self.connect() as db:
            db.execute('INSERT INTO items VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
                       (kind,item['id'],json.dumps(item,ensure_ascii=False)))
        return item

    def event(self,action,data):
        with self.lock,self.connect() as db:
            last=db.execute('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').fetchone()
            prev=last[0] if last else ''; at=now(); payload=json.dumps(data,sort_keys=True,ensure_ascii=False)
            hash=hashlib.sha256((prev+at+action+payload).encode()).hexdigest()
            db.execute('INSERT INTO events(at,action,data,prev,hash) VALUES(?,?,?,?,?)',(at,action,payload,prev,hash))

    def events(self):
        with self.connect() as db:
            return [dict(seq=r[0],at=r[1],action=r[2],data=json.loads(r[3]),prev=r[4],hash=r[5]) for r in db.execute('SELECT * FROM events ORDER BY seq')]

    def put_many(self,items):
        """Atomically persist a bounded worker chunk and its cursor."""
        with self.lock,self.connect() as db:
            db.executemany('INSERT INTO items VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
                           [(kind,item['id'],json.dumps(item,ensure_ascii=False)) for kind,item in items])

    def filtered(self,kind,key,value):
        return self.page(kind,0,10000,where_key=key,where_value=value)['items']

    def page(self,kind,offset=0,limit=25,where_key=None,where_value=None):
        import re
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=10000:
            raise ValueError('Ungültige Seitengröße.')
        clause='kind=?';params=[kind]
        if where_key:
            if not re.fullmatch(r'[a-z_]+',where_key):raise ValueError('Ungültiger Filter.')
            clause+=' AND json_extract(data,?)=?';params+=['$.'+where_key,where_value]
        with self.connect() as db:
            total=db.execute('SELECT COUNT(*) FROM items WHERE '+clause,params).fetchone()[0]
            rows=db.execute('SELECT data FROM items WHERE '+clause+' ORDER BY rowid LIMIT ? OFFSET ?',params+[limit,offset])
            return {'items':[json.loads(r[0]) for r in rows],'total':total,'offset':offset,'limit':limit}

    def get_many(self,kind,ids):
        if not ids:return {}
        if len(ids)>500:raise ValueError('Lesechunk zu groß.')
        with self.connect() as db:
            rows=db.execute('SELECT id,data FROM items WHERE kind=? AND id IN ('+','.join('?' for _ in ids)+')',[kind,*ids])
            return {id:json.loads(data) for id,data in rows}
