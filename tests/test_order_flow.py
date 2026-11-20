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
