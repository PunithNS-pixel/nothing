"""Live Postgres concurrency test. Run inside the api Docker container.

Creates two test accounts and one test-only SKU with stock=1. Expect one successful
checkout and one stock conflict. Does not change production seed inventory.
"""
import concurrent.futures
from uuid import uuid4
import httpx
from app.config import get_settings
BASE='http://127.0.0.1:8000'
settings=get_settings()
if not settings.admin_password or settings.admin_password.startswith('REPLACE_'):
    raise SystemExit('Configure ADMIN_PASSWORD and run seed first')

def call(method,path,**kwargs):
    with httpx.Client(timeout=25) as c: return c.request(method,BASE+path,**kwargs)

def json_ok(r,expected):
    if r.status_code not in expected: raise RuntimeError(f'{r.request.method} {r.url}: HTTP {r.status_code}: {r.text[:300]}')
    return r.json()

admin=json_ok(call('POST','/auth/login',json={'email':settings.admin_email,'password':settings.admin_password}),{200})['access_token']
headers={'Authorization':'Bearer '+admin}
sku='TEST-RACE-'+uuid4().hex[:12].upper()
product=json_ok(call('POST','/admin/products',headers=headers,json={'sku':sku,'name':'Race Test Only','description':'Temporary concurrency test SKU','category':'Internal Tests','price':'11.00'}),{201})
product_id=product['id']
json_ok(call('PATCH',f'/admin/products/{product_id}/stock',headers=headers,json={'city':'Bengaluru','quantity':1}),{200})
tokens=[]
for i in range(2):
    email=f'race-{uuid4().hex[:12]}-{i}@example.test';password='TestPasswordThatIsLong123!'
    json_ok(call('POST','/auth/register',json={'email':email,'password':password}),{201})
    token=json_ok(call('POST','/auth/login',json={'email':email,'password':password}),{200})['access_token']
    json_ok(call('POST','/cart/items',headers={'Authorization':'Bearer '+token},json={'product_id':product_id,'city':'Bengaluru','quantity':1}),{200})
    tokens.append(token)

def checkout(token):
    return call('POST','/orders/checkout',headers={'Authorization':'Bearer '+token,'Idempotency-Key':'race-'+uuid4().hex},json={'city':'Bengaluru'})
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: statuses=sorted([f.result().status_code for f in [pool.submit(checkout,t) for t in tokens]])
    qty=json_ok(call('GET',f'/products/{product_id}'),{200})['inventory']['Bengaluru']
    print('Checkout status codes:',statuses,'Remaining stock:',qty)
    if statuses != [201,409] or qty!=0: raise SystemExit('FAIL: inconsistent concurrent checkout results')
    print('PASS: exactly one checkout succeeded and stock was not oversold')
finally:
    json_ok(call('PATCH',f'/admin/products/{product_id}',headers=headers,json={'active':False}),{200})
