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
