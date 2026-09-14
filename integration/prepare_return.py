"""Prepare one immutable docs review ZIP and AI-Shared compatible READY-last marker.
Candidate only; never writes Registry, CURRENT HANDOFF, or Authority Ledger.
"""
import argparse, hashlib, json, os, re, tempfile, zipfile
from pathlib import Path
from datetime import datetime, timezone

def digest(data):return hashlib.sha256(data).hexdigest()
def record(name,data):return {'relativePath':name,'byteLength':len(data),'sha256':digest(data)}
def safe_ancestors(path):
    for item in [path,*path.parents]:
        if item.exists() and (item.is_symlink() or getattr(item,'is_junction',lambda:False)()):raise ValueError('Linked output path')
def prepare(repo, destination, task, actor):
    if not all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}',x) for x in [task,actor]):raise ValueError('Invalid task/actor')
    safe_ancestors(destination)
    if destination.exists():raise FileExistsError('Immutable return exists; use a new attempt directory')
    # Re-run real source/build verification rather than trusting a stale report.
    import subprocess
    for script in ['scripts/build.mjs']:
        subprocess.run(['node',script],cwd=repo,check=True,capture_output=True)
    report=(repo/'.state/publication-report.json').read_bytes()
    selection=(repo/'publication.json').read_bytes()
    if digest(selection)!=json.loads(report)['selectionSha256']:raise ValueError('Selection changed during preparation')
    payload={'publication-report.json':report,'publication.json':selection,
      'RESULT.json':json.dumps({'taskId':task,'actor':actor,'state':'LOCAL_VALIDATED_CANDIDATE','humanAcceptance':False,'transportReviewReady':False,'registryMutation':False,'handoffBase':'UNBOUND_BASE','deployment':'NOT_WITNESSED'},indent=2).encode(),
      'README_FIRST.txt':b'Docs publication candidate. Human review and external deployment evidence are separate.\n'}
    for entry in json.loads(report)['documents']:
        source=entry['source'];safe_ancestors(repo/source);data=(repo/source).read_bytes()
        if digest(data)!=entry['sha256']:raise ValueError('Source changed during preparation')
        payload[source]=data
    if report!=(repo/'.state/publication-report.json').read_bytes() or selection!=(repo/'publication.json').read_bytes():raise ValueError('Concurrent publication change')
    payload['MANIFEST.sha256']=''.join(f'{digest(data)}  {name}\n' for name,data in sorted(payload.items())).encode()
    destination.parent.mkdir(parents=True,exist_ok=True)
    safe_ancestors(destination.parent)
    temp=Path(tempfile.mkdtemp(prefix='.docs-return-',dir=destination.parent))
    zip_path=temp/'docs-review.zip'
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in sorted(payload.items()):z.writestr(name,data)
    with zipfile.ZipFile(zip_path) as z:
        if z.testzip() is not None:raise ValueError('CRC failed')
        if set(z.namelist())!=set(payload):raise ValueError('ZIP set mismatch')
        for name,data in payload.items():
            if z.read(name)!=data:raise ValueError('ZIP readback mismatch')
    zip_bytes=zip_path.read_bytes()
    verification={'sha256':digest(zip_bytes),'byteLength':len(zip_bytes),'entryCount':len(payload),'crc':'PASS','manifest':'PASS','taskId':task,'actor':actor}
    verification_bytes=(json.dumps(verification,indent=2)+'\n').encode()
    (temp/'ZIP_VERIFICATION.json').write_bytes(verification_bytes)
    ready={'completedAtUtc':datetime.now(timezone.utc).isoformat(),'taskId':task,'actor':actor,'writerPolicy':'PRODUCER_AI_DIRECT','summary':'Docs publication local review candidate; no acceptance/deploy witness','files':[record('docs-review.zip',zip_bytes),record('ZIP_VERIFICATION.json',verification_bytes)]}
    # Ready marker exists only after complete immutable payload + readback.
    (temp/'RETURN_READY.json').write_text(json.dumps(ready,indent=2)+'\n',encoding='utf8')
    if destination.exists():raise FileExistsError('Return collision')
    temp.rename(destination)
    return verification

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--out',type=Path,required=True);p.add_argument('--task',required=True);p.add_argument('--actor',required=True);a=p.parse_args()
    print(json.dumps(prepare(a.repo.resolve(),a.out.absolute(),a.task,a.actor),indent=2))
