"""Generate only authored, synthetic demo material. No uploaded source text is copied.
Import authoritative user documents through the UI and review them separately.
"""
import copy,hashlib,json
from pathlib import Path
from synthetic_fixture import build_fixture
ROOT=Path(__file__).resolve().parents[1]

def document(id,name,sections):
    return {'id':id,'name':name,'version':'synthetic-demo-v1','valid_from':None,'kind':'authored-demo',
            'sha256':hashlib.sha256(json.dumps(sections,sort_keys=True).encode()).hexdigest(),'sections':sections,
            'note':'Vollständig synthetische, selbst verfasste Demo-Spezifikation. Keine Originalquelle und keine Rechtsgrundlage.'}
texts=[('C1','Attestierte aktuelle und frühere AU','Demo requirement: allow an enquiry only when the current absence and at least one prior absence have confirmed certificate status.'),
 ('C2','Vorerkrankung innerhalb sechs Monaten','Demo requirement: check the calendar-month gap between current absence and the latest certified prior absence. Leave the exact six-month boundary unresolved.'),
 ('C3','Kette der übermittelten AU-Zeiten','Demo requirement: compare transmitted periods with the synthetic profile and check their descending order and calendar-month gaps.'),
 ('C4','Mindestens 30 Tage im Systembestand','Demo requirement: test a 30-day threshold using the synthetic system-side absence stock, not only the transmitted period list. Unresolved counting assumptions prevent assessment.')]
sections=[{'id':id,'location':'Selbst verfasste Demoregel '+id,'text':text} for id,title,text in texts]
source=document('DOC-CRITERIA','Synthetic demo requirements.txt',sections)
rules=[{'id':id,'title':title,'criterion':text,'source_id':source['id'],'section_id':id,'source_excerpt':text,
        'citation_status':'verified','status':'pending','semantic_review':'pending','mapping':id,'ruleset':'fixture-2026',
        'questions':['Demo-Regel; für echte Prüfung durch fachlich bestätigte Originalanforderung ersetzen.'],
        'note':'Wörtlicher Abgleich mit selbst verfasster Demoregel; keine fachliche Freigabe.'} for id,title,text in texts]
prior=[{'begin':a,'end':b,'certified':True} for a,b in [('2025-10-14','2025-10-15'),('2026-01-01','2026-01-17'),('2026-03-01','2026-03-03'),('2026-06-01','2026-06-03')]]
base={'current':{'begin':'2026-06-11','end':'2026-06-20','certified':True},'prior':prior,'report_date':'2026-06-11','employment_end':'2026-06-30','insurance':'synthetic-demo'}
cases=[]
def case(id,name,s,expected):
 cases.append({'id':id,'name':name,'ruleset':'fixture-2026','scenario':s,'expected_message':expected,
 'expectation_source':'Selbst konstruierte Demo-Erwartung; keine Original-Testkonstellation. Fachliche Freigabe offen.',
 'review_status':'pending','requirement_ids':['C1','C2','C4']+(['C3'] if id=='CASE-001' else []),'fixture_questions':[]})
case('CASE-001','Synthetisches Profil · 35 Tage',base,True)
s=copy.deepcopy(base);s['current']['certified']=False;case('CASE-002','Kein Nachweis der aktuellen AU',s,False)
for n in [29,30,31]:
 s=copy.deepcopy(base);s['prior']=[{'begin':'2026-05-01','end':f'2026-05-{n-10:02}','certified':True}]
 case(f'CASE-00{n-26}',f'Grenzwert · {n} Tage Systembestand',s,n>=30)
s=copy.deepcopy(base);s['current']['end']=None;case('CASE-006','Offene AU · Zählkonvention ungeklärt',s,None)
s=copy.deepcopy(base);s['prior']=[{'begin':'2025-11-01','end':'2025-11-15','certified':True}];case('CASE-007','Vorerkrankung außerhalb sechs Monaten',s,False)
s=copy.deepcopy(base);s['prior']=[{'begin':'2025-12-01','end':'2025-12-11','certified':True}];case('CASE-008','Exakte Sechsmonatsgrenze · offen',s,None)
chain=[{'step':1,'sender':'AG','reason':'41','id':'00000000-0000-4000-8000-000000000001','note':'Synthetische Anfrage'},
 {'step':2,'sender':'KK','reason':'61','reference':'00000000-0000-4000-8000-000000000001','note':'Synthetische Rückmeldung; Nachweis fehlt'},
 {'step':3,'sender':'AG','reason':'01','id':'00000000-0000-4000-8000-000000000002','note':'Synthetische Bescheinigung'},
 {'step':4,'sender':'KK','reason':'61','reference':'00000000-0000-4000-8000-000000000001','note':'Nachweis ergänzt; illustrative Korrektur'},
 {'step':5,'sender':'AG','reason':'88','id':'00000000-0000-4000-8000-000000000003','cancelled_id':'00000000-0000-4000-8000-000000000002'},
 {'step':6,'sender':'AG','reason':'01','id':'00000000-0000-4000-8000-000000000004','note':'Neue illustrative Bescheinigung'},
 {'step':7,'sender':'KK','reason':'62','reference':'00000000-0000-4000-8000-000000000004','note':'Illustratives Ende; keine Leistungsberechnung'}]
scenario=document('DOC-SCENARIO','Synthetic demo sequence.txt',[{'id':'overview','location':'Demo narrative','text':'An entirely synthetic sequence illustrates an enquiry, responses, cancellation and replacement. It does not reproduce a supplied person, source example or authoritative expected outcome.'}])
(ROOT/'data/seed.json').write_text(json.dumps({'documents':[source,scenario],'requirements':rules,'cases':cases,'chain':chain},ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'data/sample.teel').write_bytes(build_fixture())
print('Authored synthetic demo seed generated; no original source text or scenario identifiers.')
