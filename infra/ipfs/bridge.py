#!/usr/bin/env python3
"""Private, token-protected application bridge; never exposes Kubo RPC."""
import json,os,subprocess,hmac,re,sqlite3,datetime,hashlib
from urllib.parse import urlparse,parse_qs
DB="/var/lib/ipfs-publications/records.sqlite"
os.makedirs(os.path.dirname(DB),exist_ok=True)
with sqlite3.connect(DB) as db:db.execute("CREATE TABLE IF NOT EXISTS files(owner TEXT,job TEXT,cid TEXT,title TEXT,bytes INTEGER,published TEXT,sha256 TEXT,PRIMARY KEY(owner,cid))")
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
TOKEN=open('/etc/astra-ipfs-bridge-token').read().strip()
def ipfs(*args,input=None):
 return subprocess.run(['/usr/local/bin/ipfs',*args],input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'IPFS_PATH':'/var/lib/ipfs'},timeout=20,check=True).stdout
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def respond(self,status,data,kind='application/json'):
  body=json.dumps(data).encode() if kind=='application/json' else data
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def authorized(self):
  if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+TOKEN):self.respond(401,{'error':'Unauthorized'});return False
  return True
 def do_GET(self):
  if not self.authorized():return
  try:
   if self.path.startswith('/files?'):
    owner=parse_qs(urlparse(self.path).query).get('owner',[''])[0]
    if not re.fullmatch('[0-9a-f-]{36}',owner):raise ValueError()
    with sqlite3.connect(DB) as db:
     db.row_factory=sqlite3.Row;rows=[dict(r) for r in db.execute('SELECT job,cid,title,bytes,published,sha256 FROM files WHERE owner=? ORDER BY published DESC LIMIT 100',(owner,))]
    self.respond(200,{'items':rows});return
   if self.path=='/status':
    stats=json.loads(ipfs('repo','stat','--enc=json'));peers=ipfs('swarm','peers').decode().splitlines()
    self.respond(200,{'connected':True,'peers':len(peers),'repoBytes':stats['RepoSize'],'storageMaxBytes':stats['StorageMax'],'provider':'Astra-Via hosted IPFS','replicas':1});return
   if self.path.startswith('/content/'):
    cid=self.path.split('/')[-1]
    if not re.fullmatch('b[a-z2-7]{20,120}',cid):raise ValueError()
    ipfs('pin','ls',cid,'--type=recursive');content=ipfs('cat',cid)
    if len(content)>128000:raise ValueError()
    self.respond(200,content,'application/octet-stream');return
   self.respond(404,{'error':'Not found'})
  except Exception:self.respond(503,{'error':'IPFS operation unavailable'})
 def do_POST(self):
  if not self.authorized():return
  try:
   size=int(self.headers.get('Content-Length','0'))
   if self.path!='/publish' or not 0<size<=128000:self.respond(400,{'error':'Invalid request'});return
   request=json.loads(self.rfile.read(size));owner=request['owner'];job=request['job'];title=request['title']
   if not re.fullmatch('[0-9a-f-]{36}',owner) or not re.fullmatch('[0-9a-f-]{36}',job):raise ValueError()
   body=json.dumps(request['bundle'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
   cid=ipfs('add','--cid-version=1','--raw-leaves=true','--pin=true','-Q',input=body).decode().strip()
   sha=hashlib.sha256(body).hexdigest();published=datetime.datetime.now(datetime.timezone.utc).isoformat()
   with sqlite3.connect(DB) as db:db.execute('INSERT OR IGNORE INTO files VALUES(?,?,?,?,?,?,?)',(owner,job,cid,title,len(body),published,sha))
   self.respond(201,{'cid':cid,'bytes':len(body),'pinned':True,'sha256':sha,'published':published})
  except Exception:self.respond(503,{'error':'IPFS publication failed'})
ThreadingHTTPServer(('10.21.0.2',8787),Handler).serve_forever()
