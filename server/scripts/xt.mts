import fs from 'node:fs';
import { parseEel, buildEelFile } from '../src/eel.ts';
const f = '/mnt/user-data/attachments/51c09977-1140-519c-afa9-070734efe80f/0b090b9a-TEEL0-Test1-DBVO';
const p = parseEel(fs.readFileSync(f));
console.log('encoding', p.encoding, p.encodingBasis, p.lineEnding, 'records', p.records.map(r=>r.tag+':'+r.chars).join(' '));
console.log('errors', p.errors); console.log('warnings', p.warnings.map(w=>w.slice(0,110)));
const m = p.messages[0];
console.log({abg:m.abgabegrund, dsid:m.dsid, azvu:m.azvu, ver:m.version, abs:m.absender, prod:m.produktId});
console.log(m.blocks);
console.log(JSON.stringify(m.dbvo));
// Round-Trip
const out = buildEelFile([{abgabegrund:'41', dsid:'11111111-2222-AAAA-EEEE-111111111111', azvu:'1234-5678-007', dbvo:{auAbAg:'20260311', entries:[{beginn:'20260301',ende:'20260303'},{beginn:'20251201',ende:'20251203'}]}}]);
const q = parseEel(Buffer.from(out));
console.log('roundtrip errors', q.errors, 'dbvo anzahl', q.messages[0].dbvo?.anzahl, q.messages[0].blocks.map(b=>b.tag+'@'+b.start+'+'+b.length).join(' '));
const out2 = buildEelFile([{abgabegrund:'01', dsid:'AAAAAAAA-EEEE-2222-4444-BBBBBBBBBBBB', azvu:'1234-5678-007', dbal:{datumAb:'20260311', efzEnde:'20260330'}},{abgabegrund:'88', dsid:'BBBBBBBB-8888-5555-CCCC-121212121212', azvu:'1234-5678-007', dbsd:{dsidUr:'AAAAAAAA-EEEE-2222-4444-BBBBBBBBBBBB', vorname:'Peter', familienname:'Mustermann'}}]);
const q2 = parseEel(Buffer.from(out2)); console.log('rt2 errors', q2.errors, q2.messages.map(m=>[m.abgabegrund, m.dbal?.efzEnde, m.dsidUr]));
// kaputte Datei
try { console.log(parseEel(Buffer.from('Hallo Welt\r\n')).errors); } catch(e:any){ console.log('Fehler', e.message); }
