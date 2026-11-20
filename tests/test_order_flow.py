"""SQLite API contract test; live PostgreSQL concurrency is tested by scripts/concurrency_check.py."""
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.main import app
from app.models import Product, Inventory, Outbox, Order, User
from app.security import hash_password

@pytest.fixture
def api():
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    def db_override():
        with Session(engine) as db: yield db
    app.dependency_overrides[get_db]=db_override
    with Session(engine) as db:
        admin=User(email='test-admin@example.com',password_hash=hash_password('ReallyStrongTestPassword123!'),role='admin')
        product=Product(sku='ENERGY-ORIGINAL',name='Original',description='250ml drink',category='Energy Drinks',price='149.00')
        db.add_all([admin,product]);db.flush()
        db.add(Inventory(product_id=product.id,city='Bengaluru',quantity=1));pid=product.id
        db.commit()
    with TestClient(app) as client:
        yield client,pid,engine
    app.dependency_overrides.clear()
    engine.dispose()

def login(client,email,password):
    r=client.post('/auth/login',json={'email':email,'password':password})
    assert r.status_code==200,r.text
    return {'Authorization':'Bearer '+r.json()['access_token']}

def test_register_admin_and_stock_safe_checkout(api):
    client,pid,engine=api
    users=[]
    for i in range(2):
        email=f'checkout{i}@example.com';password='ReallyStrongTestPassword123!'
        r=client.post('/auth/register',json={'email':email,'password':password});assert r.status_code==201,r.text
        users.append(login(client,email,password))
    assert client.get('/admin/users',headers=users[0]).status_code==403
    admin=login(client,'test-admin@example.com','ReallyStrongTestPassword123!')
    assert client.get('/admin/users',headers=admin).json()['total']==3
    assert client.get('/admin/summary',headers=admin).json()['customers']==2
    for h in users:
        assert client.post('/cart/items',headers=h,json={'product_id':pid,'city':'Bengaluru','quantity':1}).status_code==200
    key='test-checkout-'+uuid4().hex
    a=client.post('/orders/checkout',headers={**users[0],'Idempotency-Key':key},json={'city':'Bengaluru'})
    assert a.status_code==201,a.text
    assert a.json()['total']=='149.00'
    assert client.post('/orders/checkout',headers={**users[0],'Idempotency-Key':key},json={'city':'Bengaluru'}).json()['id']==a.json()['id']
    b=client.post('/orders/checkout',headers={**users[1],'Idempotency-Key':uuid4().hex},json={'city':'Bengaluru'})
    assert b.status_code==409,b.text
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==0
        assert len(db.scalars(select(Order)).all())==1
        names=[r.event_type for r in db.scalars(select(Outbox)).all()]
        assert names.count('order.placed')==1 and names.count('inventory.changed')==1
    assert client.get('/admin/orders',headers=admin).json()['items'][0]['customer_email']=='checkout0@example.com'

def test_protected_customer_data(api):
    client,pid,engine=api
    assert client.get('/orders').status_code==401
    assert client.get('/admin/summary').status_code==401
    assert client.get('/admin/audit').status_code==401
    assert client.get('/products').status_code==200
    bad=client.patch(f'/admin/products/{pid}/stock',json={'city':'Bengaluru','quantity':-1})
    assert bad.status_code==401

def test_gstin_retailer_approval_and_server_side_discount(api):
    from app.retailers import gstin_checksum, validate_gstin
    from decimal import Decimal
    client,pid,engine=api
    gstin_prefix='29ABCDE1234F1Z'
    gstin=gstin_prefix+gstin_checksum(gstin_prefix)
    assert validate_gstin(gstin)==gstin
    with pytest.raises(ValueError): validate_gstin(gstin[:-1]+'!')
    owner='retailer@example.com'
    pwd='ReallyStrongTestPassword123!'
    assert client.post('/auth/register',json={'email':owner,'password':pwd}).status_code==201
    retailer=login(client,owner,pwd)
    admin=login(client,'test-admin@example.com',pwd)
    assert client.get('/retailers/me').status_code==401
    assert client.get('/admin/retailers',headers=retailer).status_code==403
    assert client.post('/retailers/apply',headers=retailer,json={'business_name':'Test Energy Distribution','gstin':'INVALID'}).status_code==422
    assert client.post('/retailers/apply',headers=retailer,json={'business_name':'Test Energy Distribution','gstin':gstin}).status_code==201
    assert client.get('/retailers/me',headers=retailer).json()['status']=='pending'
    prices=client.get('/retailers/prices',headers=retailer).json()
    assert prices['approved'] is False
    assert next(x for x in prices['items'] if x['id']==pid)['effective_price']=='149.00'
    profile=client.get('/admin/retailers',headers=admin).json()['items'][0]
    assert profile['gstin']==gstin and profile['status']=='pending'
    url=f'/admin/retailers/{profile["id"]}/review'
    assert client.patch(url,headers=retailer,json={'status':'approved','review_note':'Not an admin verification'}).status_code==403
    assert client.patch(url,headers=admin,json={'status':'approved','review_note':'Official GST portal checked manually'}).status_code==200
    prices=client.get('/retailers/prices',headers=retailer).json()
    assert prices['approved'] is True
    assert next(x for x in prices['items'] if x['id']==pid)['effective_price']=='126.65'
    assert client.post('/cart/items',headers=retailer,json={'product_id':pid,'city':'Bengaluru','quantity':1}).status_code==200
    order=client.post('/orders/checkout',headers={**retailer,'Idempotency-Key':uuid4().hex},json={'city':'Bengaluru'})
    assert order.status_code==201,order.text
    assert Decimal(order.json()['total'])==Decimal('126.65')
    assert order.json()['items'][0]['price']=='126.65'
    # A non-retailer cannot self-approve and gets ordinary prices.
    assert client.post('/auth/register',json={'email':'normal@example.com','password':pwd}).status_code==201
    normal=login(client,'normal@example.com',pwd)
    assert client.get('/retailers/prices',headers=normal).json()['items'][0]['effective_price']=='149.00'
    assert client.post('/retailers/apply',headers=normal,json={'business_name':'Different Business','gstin':gstin}).status_code==409
    assert client.patch(url,headers=admin,json={'status':'suspended','review_note':'Verification is no longer valid'}).status_code==200
    assert client.get('/retailers/prices',headers=retailer).json()['items'][0]['effective_price']=='149.00'
    with Session(engine) as db:
        assert db.scalar(select(Order.total))==Decimal('126.65')
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==0


def test_stripe_checkout_requires_backend_credentials(api):
    client,pid,engine=api
    email='stripe-unconfigured@example.com';pw='ReallyStrongTestPassword123!'
    assert client.post('/auth/register',json={'email':email,'password':pw}).status_code==201
    token=login(client,email,pw)
    assert client.post('/cart/items',headers=token,json={'product_id':pid,'city':'Bengaluru','quantity':1}).status_code==200
    result=client.post('/payments/stripe/checkout',headers={**token,'Idempotency-Key':uuid4().hex},json={'city':'Bengaluru'})
    assert result.status_code==503
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==1
        assert db.scalars(select(Order)).all()==[]


def test_stripe_signed_webhook_confirms_payment_once_and_recovers_inventory(api,monkeypatch):
    import hashlib,hmac,json,time
    from types import SimpleNamespace
    from app import payments
    client,pid,engine=api
    cfg=SimpleNamespace(stripe_secret_key='sk_test_mock_key_no_remote_calls',stripe_webhook_secret='whsec_local_test_only',
                        environment='development',public_base_url='http://localhost:8080')
    monkeypatch.setattr(payments,'get_settings',lambda:cfg)
    sessions={}
    def fake_create(**kwargs):
        sid='cs_test_'+kwargs['client_reference_id'].replace('-','')
        s={'id':sid,'url':'https://checkout.stripe.com/c/pay/'+sid,'status':'open',
           'payment_status':'unpaid','amount_total':kwargs['line_items'][0]['price_data']['unit_amount'],
           'currency':'inr','metadata':kwargs['metadata'],'client_reference_id':kwargs['client_reference_id'],
           'payment_intent':'pi_test_123'}
        sessions[sid]=s
        return s
    monkeypatch.setattr(payments.stripe.checkout.Session,'create',fake_create)
    monkeypatch.setattr(payments.stripe.checkout.Session,'retrieve',lambda sid:sessions[sid])
    def fake_expire(sid):
        sessions[sid]['status']='expired';return sessions[sid]
    monkeypatch.setattr(payments.stripe.checkout.Session,'expire',fake_expire)
    def signed(event_type,session,valid=True):
        payload=json.dumps({'id':'evt_'+uuid4().hex,'object':'event','type':event_type,'data':{'object':session}})
        ts=int(time.time());secret='whsec_local_test_only' if valid else 'wrong-secret'
        digest=hmac.new(secret.encode(),f'{ts}.{payload}'.encode(),hashlib.sha256).hexdigest()
        return client.post('/payments/stripe/webhook',content=payload,headers={'Stripe-Signature':f't={ts},v1={digest}'})
    pw='ReallyStrongTestPassword123!';email='stripe-test@example.com'
    assert client.post('/auth/register',json={'email':email,'password':pw}).status_code==201
    token=login(client,email,pw)
    assert client.post('/cart/items',headers=token,json={'product_id':pid,'city':'Bengaluru','quantity':1}).status_code==200
    key=uuid4().hex
    started=client.post('/payments/stripe/checkout',headers={**token,'Idempotency-Key':key},json={'city':'Bengaluru'})
    assert started.status_code==201,started.text
    order_id=started.json()['order_id'];sid=next(iter(sessions))
    assert started.json()['payment_status']=='pending'
    again=client.post('/payments/stripe/checkout',headers={**token,'Idempotency-Key':key},json={'city':'Bengaluru'})
    assert again.status_code==201 and again.json()['checkout_url']==started.json()['checkout_url']
    assert client.post('/orders/checkout',headers={**token,'Idempotency-Key':uuid4().hex},json={'city':'Bengaluru'}).status_code==409
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==0
        assert db.scalars(select(Outbox).where(Outbox.event_type=='order.placed')).all()==[]
    assert signed('checkout.session.completed',sessions[sid],valid=False).status_code==400
    unpaid=signed('checkout.session.completed',sessions[sid])
    assert unpaid.status_code==200 and client.get(f'/payments/stripe/orders/{order_id}',headers=token).json()['payment_status']=='pending'
    sessions[sid]['payment_status']='paid';sessions[sid]['status']='complete'
    assert signed('checkout.session.completed',sessions[sid]).status_code==200
    assert signed('checkout.session.completed',sessions[sid]).status_code==200
    record=client.get(f'/orders/{order_id}',headers=token)
    assert record.status_code==200 and record.json()['payment_status']=='paid' and record.json()['status']=='placed'
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==0
        assert len(db.scalars(select(Outbox).where(Outbox.event_type=='order.placed')).all())==1
    # An out-of-order expiration event must never restore already-paid inventory.
    assert signed('checkout.session.expired',sessions[sid]).status_code==200
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==0


def test_stripe_cancel_restores_stock_once(api,monkeypatch):
    from types import SimpleNamespace
    from app import payments
    client,pid,engine=api
    monkeypatch.setattr(payments,'get_settings',lambda:SimpleNamespace(stripe_secret_key='sk_test_mock',stripe_webhook_secret='whsec_mock',environment='development',public_base_url='http://localhost:8080'))
    session={'id':'cs_test_cancel','status':'open','payment_status':'unpaid','amount_total':14900,'currency':'inr','metadata':{}}
    def create(**kw):session['metadata']={'order_id':kw['client_reference_id']};return {**session,'url':'https://checkout.stripe.com/c/pay/cs_test_cancel'}
    monkeypatch.setattr(payments.stripe.checkout.Session,'create',create)
    monkeypatch.setattr(payments.stripe.checkout.Session,'retrieve',lambda sid:session)
    def expire(sid):session['status']='expired';return session
    monkeypatch.setattr(payments.stripe.checkout.Session,'expire',expire)
    email='stripe-cancel@example.com';pw='ReallyStrongTestPassword123!'
    assert client.post('/auth/register',json={'email':email,'password':pw}).status_code==201
    token=login(client,email,pw)
    assert client.post('/cart/items',headers=token,json={'product_id':pid,'city':'Bengaluru','quantity':1}).status_code==200
    init=client.post('/payments/stripe/checkout',headers={**token,'Idempotency-Key':uuid4().hex},json={'city':'Bengaluru'})
    assert init.status_code==201,init.text
    oid=init.json()['order_id']
    cancelled=client.post(f'/payments/stripe/orders/{oid}/cancel',headers=token)
    assert cancelled.status_code==200 and cancelled.json()['payment_status']=='expired'
    assert client.post(f'/payments/stripe/orders/{oid}/cancel',headers=token).status_code==200
    with Session(engine) as db:
        assert db.scalar(select(Inventory.quantity).where(Inventory.product_id==pid))==1
        assert len(db.scalars(select(Outbox).where(Outbox.event_type=='inventory.changed')).all())==2
