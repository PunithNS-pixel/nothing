import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import select, update, func
from sqlalchemy.exc import IntegrityError
from opensearchpy.exceptions import NotFoundError
from sqlalchemy.orm import Session
from fastapi import FastAPI, Depends, HTTPException, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from app.config import get_settings
from app.db import get_db, engine
from app.models import User, Product, Inventory, CartItem, Order, OrderItem, Outbox, AuditLog, RefreshToken, NewsletterSubscriber, RetailerProfile, uid
from app.schemas import Register, Login, Refresh, ProductIn, StockIn, CartIn, CheckoutIn, ProductOut, ProductPatch, FulfillmentStatus, NewsletterIn, RetailerApply, RetailerReview
from app.security import hash_password, verify_password, new_refresh, access_token, token_digest, current_user, admin_user
from app.search import client as search_client, search_products, ensure_search_ready
from app.retailers import validate_gstin, retailer_for, retailer_approved, price_for

settings = get_settings()
logger=logging.getLogger('nothing.store')
if not 0 <= settings.retailer_discount_percent <= 50:
    raise RuntimeError('RETAILER_DISCOUNT_PERCENT must be between 0 and 50')
if settings.environment == 'production' and (settings.jwt_secret.startswith(('CHANGE_ME', 'REPLACE_')) or len(settings.jwt_secret)<32):
    raise RuntimeError('Set a strong JWT_SECRET before production')

REQUESTS = Counter('store_http_requests_total','HTTP requests',['method','path','status'])
LATENCY = Histogram('store_http_request_duration_seconds','HTTP latency',['method','path'])

@asynccontextmanager
async def lifespan(app):
    # Schema migration must be applied separately using `alembic upgrade head`.
    yield

app = FastAPI(title='Nothing Energy Store API', version='2.0.0', lifespan=lifespan, root_path='/api')
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(',') if x.strip()], allow_credentials=False, allow_methods=['GET','POST','PATCH','DELETE'], allow_headers=['Authorization','Content-Type','Idempotency-Key'])

@app.middleware('http')
async def telemetry(request: Request, call_next):
    started=time.monotonic(); route='unmatched'; status=500
    try:
        resp = await call_next(request)
        status=resp.status_code
        resp.headers['X-Content-Type-Options']='nosniff'
        resp.headers['X-Frame-Options']='DENY'
        resp.headers['Referrer-Policy']='no-referrer'
        resp.headers['Cache-Control']='no-store' if request.url.path.startswith('/auth') else 'private, max-age=0'
        return resp
    finally:
        if request.scope.get('route'): route=request.scope['route'].path
        REQUESTS.labels(request.method,route,str(status)).inc()
        LATENCY.labels(request.method,route).observe(time.monotonic()-started)

@app.get('/health/live')
def live(): return {'status':'ok'}

@app.get('/health/ready')
def ready(db: Session=Depends(get_db)):
    try: db.execute(select(1)).scalar_one()
    except Exception: raise HTTPException(503, 'Database unavailable')
    return {'status':'ready', 'database':'ok'}

@app.get('/health/search')
def search_health():
    c=search_client()
    try:
        idx=settings.opensearch_index
        reachable=c.ping()
        if not reachable: raise RuntimeError('OpenSearch ping failed')
        index_exists=c.indices.exists(index=idx)
        count=c.count(index=idx)['count'] if index_exists else 0
        return {'status':'ready' if index_exists and count else 'unindexed',
                'index':idx,'documents':count,'cluster_reachable':True}
    except Exception:
        logger.exception('OpenSearch health check failed')
        raise HTTPException(503,'OpenSearch not reachable; check docker compose ps and logs')
    finally: c.close()

@app.get('/metrics', include_in_schema=False)
def metrics(): return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

def event(db, kind, aggregate_id, payload):
    db.add(Outbox(event_type=kind, aggregate_id=aggregate_id, payload=payload))

def audit(db, user, action, target): db.add(AuditLog(actor_id=user.id, action=action, target_id=target))

def safe_user(u): return {'id':u.id,'email':u.email,'role':u.role}

def retailer_json(row):
    if row is None: return {'status':'not_applied','approved':False}
    return {'id':row.id,'business_name':row.business_name,'gstin':row.gstin,
            'status':row.status,'approved':row.status=='approved',
            'created_at':row.created_at.isoformat() if row.created_at else None}

@app.get('/retailers/me')
def my_retailer_profile(user:User=Depends(current_user),db:Session=Depends(get_db)):
    return {**retailer_json(retailer_for(db,user.id)), 'retailer_discount_percent':settings.retailer_discount_percent}

@app.post('/retailers/apply', status_code=201)
def apply_retailer(data:RetailerApply,user:User=Depends(current_user),db:Session=Depends(get_db)):
    if user.role=='admin': raise HTTPException(403,'Admin accounts cannot submit retail applications')
    try: gstin=validate_gstin(data.gstin)
    except ValueError as e: raise HTTPException(422,str(e)) from e
    row=retailer_for(db,user.id)
    if row and row.status in ('pending','approved','suspended'):
        raise HTTPException(409,'Application already exists; contact support for changes')
    if row:
        row.business_name=data.business_name.strip();row.gstin=gstin;row.status='pending'
        row.reviewed_at=None;row.reviewed_by=None;row.review_note=None
    else:
        row=RetailerProfile(user_id=user.id,business_name=data.business_name.strip(),gstin=gstin)
        db.add(row)
    audit(db,user,'retailer.apply',user.id)
    try: db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'GSTIN already registered or concurrent application')
    db.refresh(row)
    return retailer_json(row)

@app.get('/retailers/prices')
def retailer_prices(user:User=Depends(current_user),db:Session=Depends(get_db)):
    approved=retailer_approved(db,user.id)
    products=db.scalars(select(Product).where(Product.active.is_(True))).all()
    return {'approved':approved,'discount_percent':settings.retailer_discount_percent if approved else 0,
            'items':[{'id':p.id,'sku':p.sku,'list_price':str(p.price),'effective_price':str(price_for(p,approved))} for p in products]}

@app.get('/admin/retailers')
def admin_retailers(page:int=Query(1,ge=1),size:int=Query(25,ge=1,le=100),status:str|None=None,_admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    query=select(RetailerProfile,User.email).join(User,User.id==RetailerProfile.user_id)
    count=select(func.count()).select_from(RetailerProfile)
    if status:
        if status not in {'pending','approved','rejected','suspended'}: raise HTTPException(422,'Invalid status')
        query=query.where(RetailerProfile.status==status)
        count=count.where(RetailerProfile.status==status)
    rows=db.execute(query.order_by(RetailerProfile.created_at.desc()).offset((page-1)*size).limit(size)).all()
    return {'items':[{'user_id':row.user_id,'email':email,'review_note':row.review_note,'reviewed_at':row.reviewed_at.isoformat() if row.reviewed_at else None,**retailer_json(row)} for row,email in rows],
            'page':page,'total':db.scalar(count)}

@app.patch('/admin/retailers/{profile_id}/review')
def admin_review_retailer(profile_id:str,data:RetailerReview,admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    row=db.scalar(select(RetailerProfile).where(RetailerProfile.id==profile_id).with_for_update())
    if not row: raise HTTPException(404,'Application not found')
    if row.status==data.status: return retailer_json(row)
    transitions={'pending':{'approved','rejected'},'approved':{'suspended'},
                 'rejected':set(), 'suspended':{'approved','rejected'}}
    if data.status not in transitions.get(row.status,set()):
        raise HTTPException(409,'Invalid retailer status transition')
    row.status=data.status;row.reviewed_at=datetime.now(timezone.utc);row.reviewed_by=admin.id;row.review_note=data.review_note.strip()
    audit(db,admin,'retailer.'+data.status,row.id)
    event(db,'retailer.reviewed',row.id,{'retailer_id':row.id,'status':row.status})
    db.commit()
    return retailer_json(row)



@app.post('/auth/register', status_code=201)
def register(data: Register, db: Session=Depends(get_db)):
    user=User(email=str(data.email).lower(),password_hash=hash_password(data.password))
    db.add(user)
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409,'Email already registered')
    return safe_user(user)

@app.post('/auth/login')
def login(data: Login, db: Session=Depends(get_db)):
    u=db.scalar(select(User).where(User.email==str(data.email).lower()))
    if not u or not u.active or not verify_password(data.password,u.password_hash): raise HTTPException(401,'Invalid credentials')
    refresh=new_refresh(db,u); db.commit()
    return {'access_token':access_token(u), 'refresh_token':refresh, 'token_type':'bearer'}

@app.post('/auth/refresh')
def refresh(data: Refresh, db: Session=Depends(get_db)):
    # Lock the session token, so concurrent refreshes cannot both rotate successfully.
    row=db.scalar(select(RefreshToken).where(RefreshToken.token_hash==token_digest(data.refresh_token)).with_for_update())
    if not row or row.revoked or row.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc): raise HTTPException(401,'Invalid refresh token')
    u=db.get(User,row.user_id)
    if not u or not u.active: raise HTTPException(401,'Inactive account')
    row.revoked=True; new=new_refresh(db,u); db.commit()
    return {'access_token':access_token(u),'refresh_token':new,'token_type':'bearer'}

@app.post('/auth/logout', status_code=204)
def logout(data: Refresh, user: User=Depends(current_user), db: Session=Depends(get_db)):
    row=db.scalar(select(RefreshToken).where(RefreshToken.token_hash==token_digest(data.refresh_token), RefreshToken.user_id==user.id).with_for_update())
    if row: row.revoked=True; db.commit()
    return Response(status_code=204)

@app.get('/auth/me')
def me(user: User=Depends(current_user)): return safe_user(user)

@app.post('/admin/products', status_code=201, response_model=ProductOut)
def create_product(data: ProductIn, user: User=Depends(admin_user), db: Session=Depends(get_db)):
    p=Product(**data.model_dump()); db.add(p); db.flush()
    event(db,'product.changed',p.id,{'product_id':p.id}); audit(db,user,'product.create',p.id)
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409,'SKU already exists')
    return p

@app.patch('/admin/products/{product_id}/stock')
def set_stock(product_id: str, data: StockIn, user: User=Depends(admin_user), db: Session=Depends(get_db)):
    # Set stock is an admin correction; serialized with checkout on the same inventory row.
    p=db.get(Product, product_id)
    if not p: raise HTTPException(404,'Product not found')
    row=db.scalar(select(Inventory).where(Inventory.product_id==p.id,Inventory.city==data.city).with_for_update())
    if row: row.quantity=data.quantity
    else: db.add(Inventory(product_id=p.id,city=data.city,quantity=data.quantity))
    event(db,'inventory.changed',p.id,{'product_id':p.id,'city':data.city,'quantity':data.quantity})
    audit(db,user,'inventory.set',p.id)
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409,'Concurrent inventory edit: retry')
    return {'product_id':p.id,'city':data.city,'quantity':data.quantity}

@app.get('/products/{product_id}')
def product_detail(product_id: str, db: Session=Depends(get_db)):
    p=db.get(Product,product_id)
    if not p or not p.active: raise HTTPException(404,'Not found')
    rows=db.scalars(select(Inventory).where(Inventory.product_id==p.id)).all()
    return {**ProductOut.model_validate(p).model_dump(mode='json'),'inventory':{r.city:r.quantity for r in rows}}

@app.get('/products')
def list_products(page:int=Query(1,ge=1),size:int=Query(20,ge=1,le=100),db:Session=Depends(get_db)):
    statement=select(Product).where(Product.active.is_(True)).order_by(Product.created_at.desc(), Product.id).offset((page-1)*size).limit(size)
    return {'items':[ProductOut.model_validate(x).model_dump(mode='json') for x in db.scalars(statement)], 'page':page,'total':db.scalar(select(func.count()).select_from(Product).where(Product.active.is_(True)))}

@app.get('/search')
def search(q:str=Query('',max_length=100),category:str|None=None,city:str|None=None,min_price:Decimal|None=Query(None,ge=0),max_price:Decimal|None=Query(None,ge=0),page:int=Query(1,ge=1),size:int=Query(20,ge=1,le=100),db:Session=Depends(get_db)):
    if min_price is not None and max_price is not None and min_price>max_price: raise HTTPException(422,'Invalid price range')
    c=search_client()
    try:
        ensure_search_ready(c,db)
        return search_products(c,q.strip(),category,city,min_price,max_price,page,size)
    except Exception:
        logger.exception('OpenSearch search failed (index=%s, query=%r)',settings.opensearch_index,q)
        raise HTTPException(503,'OpenSearch index is not ready. Run: docker compose exec -T api python -m scripts.reindex; check docker compose logs opensearch consumer')
    finally: c.close()

@app.get('/cart')
def cart(user:User=Depends(current_user),db:Session=Depends(get_db)):
    rows=db.scalars(select(CartItem).where(CartItem.user_id==user.id).order_by(CartItem.id)).all()
    return {'items':[{'product_id':r.product_id,'city':r.city,'quantity':r.quantity} for r in rows]}

@app.post('/cart/items')
def upsert_cart(data:CartIn,user:User=Depends(current_user),db:Session=Depends(get_db)):
    p=db.get(Product,data.product_id)
    if not p or not p.active: raise HTTPException(404,'Product not found')
    row=db.scalar(select(CartItem).where(CartItem.user_id==user.id,CartItem.product_id==data.product_id,CartItem.city==data.city).with_for_update())
    if row: row.quantity=data.quantity
    else: db.add(CartItem(user_id=user.id,product_id=data.product_id,city=data.city,quantity=data.quantity))
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409,'Concurrent cart edit: retry')
    return {'ok':True}

@app.delete('/cart/items/{product_id}',status_code=204)
def remove_cart(product_id:str,city:str,user:User=Depends(current_user),db:Session=Depends(get_db)):
    item=db.scalar(select(CartItem).where(CartItem.user_id==user.id,CartItem.product_id==product_id,CartItem.city==city))
    if item: db.delete(item); db.commit()
    return Response(status_code=204)

def order_json(order):
    return {'id':order.id,'status':order.status,'city':order.city,'total':str(order.total),'created_at':order.created_at.isoformat(), 'items':[{'product_id':i.product_id,'name':i.name,'price':str(i.price),'quantity':i.quantity} for i in order.items]}

@app.post('/orders/checkout',status_code=201)
def checkout(data:CheckoutIn,idempotency_key:str=Header(...,alias='Idempotency-Key',min_length=8,max_length=128),user:User=Depends(current_user),db:Session=Depends(get_db)):
    # Lock user row serializes checkouts for same cart and idempotency key.
    db.execute(select(User).where(User.id==user.id).with_for_update()).scalar_one()
    existing=db.scalar(select(Order).where(Order.user_id==user.id,Order.idempotency_key==idempotency_key))
    if existing:
        if existing.city != data.city: raise HTTPException(409,'Idempotency key reused with different city')
        return order_json(existing)
    items=db.scalars(select(CartItem).where(CartItem.user_id==user.id,CartItem.city==data.city).order_by(CartItem.product_id).with_for_update()).all()
    if not items: raise HTTPException(400,'Cart is empty for this city')
    # Lock stock rows in deterministic product order to avoid deadlocks.
    products={p.id:p for p in db.scalars(select(Product).where(Product.id.in_([x.product_id for x in items])).order_by(Product.id).with_for_update())}
    stocks={r.product_id:r for r in db.scalars(select(Inventory).where(Inventory.product_id.in_([x.product_id for x in items]),Inventory.city==data.city).order_by(Inventory.product_id).with_for_update())}
    for item in items:
        p=products.get(item.product_id); stock=stocks.get(item.product_id)
        if not p or not p.active or not stock or stock.quantity<item.quantity:
            raise HTTPException(409, f'Insufficient stock for product {item.product_id}')
    approved=retailer_approved(db,user.id,lock=True)
    total=sum((price_for(products[x.product_id],approved)*x.quantity for x in items),Decimal('0.00'))
    order=Order(user_id=user.id,idempotency_key=idempotency_key,city=data.city,total=total)
    db.add(order);db.flush()
    ordered=[]
    for item in items:
        p=products[item.product_id]; stocks[item.product_id].quantity-=item.quantity
        db.add(OrderItem(order_id=order.id,product_id=p.id,name=p.name,price=price_for(p,approved),quantity=item.quantity))
        ordered.append({'product_id':p.id,'quantity':item.quantity,'price':str(price_for(p,approved))})
        event(db,'inventory.changed',p.id,{'product_id':p.id,'city':data.city,'quantity':stocks[p.id].quantity})
        db.delete(item)
    event(db,'order.placed',order.id,{'order_id':order.id,'user_id':user.id,'email':user.email,'city':data.city,'total':str(total),'items':ordered})
    audit(db,user,'order.place',order.id)
    db.commit();db.refresh(order)
    return order_json(order)

@app.get('/orders')
def my_orders(user:User=Depends(current_user),db:Session=Depends(get_db),page:int=Query(1,ge=1),size:int=Query(20,ge=1,le=100)):
    orders=db.scalars(select(Order).where(Order.user_id==user.id).order_by(Order.created_at.desc()).offset((page-1)*size).limit(size)).all()
    return {'items':[order_json(o) for o in orders], 'page':page}

@app.get('/orders/{order_id}')
def my_order(order_id:str,user:User=Depends(current_user),db:Session=Depends(get_db)):
    order=db.get(Order,order_id)
    if not order or (order.user_id!=user.id and user.role!='admin'): raise HTTPException(404,'Order not found')
    return order_json(order)

@app.patch('/admin/products/{product_id}',response_model=ProductOut)
def edit_product(product_id:str, data: ProductPatch, user:User=Depends(admin_user),db:Session=Depends(get_db)):
    p=db.scalar(select(Product).where(Product.id==product_id).with_for_update())
    if not p: raise HTTPException(404,'Product not found')
    for key,value in data.model_dump(exclude_unset=True).items():
        if value is None: raise HTTPException(422,'Null product values are not allowed')
        setattr(p,key,value)
    event(db,'product.changed',p.id,{'product_id':p.id});audit(db,user,'product.edit',p.id)
    db.commit();return p

@app.patch('/admin/orders/{order_id}/fulfillment')
def set_fulfillment(order_id:str,data:FulfillmentStatus,user:User=Depends(admin_user),db:Session=Depends(get_db)):
    order=db.scalar(select(Order).where(Order.id==order_id).with_for_update())
    if not order: raise HTTPException(404,'Order not found')
    allowed={'placed':'processing','processing':'shipped','shipped':'delivered'}
    if allowed.get(order.status)!=data.status: raise HTTPException(409,'Invalid fulfillment transition')
    order.status=data.status
    event(db,'order.status_changed',order.id,{'order_id':order.id,'status':data.status})
    audit(db,user,'order.status',order.id)
    db.commit();return order_json(order)

@app.post('/newsletter', status_code=201)
def newsletter(data: NewsletterIn, db:Session=Depends(get_db)):
    # Email subscriber list is persisted; this endpoint does not send email.
    email=str(data.email).strip().lower()
    if not db.scalar(select(NewsletterSubscriber.id).where(NewsletterSubscriber.email==email)):
        db.add(NewsletterSubscriber(email=email))
        try: db.commit()
        except IntegrityError: db.rollback()
    return {'subscribed': True}


# Admin reporting APIs: paginated, role protected, no password hashes or tokens.
@app.get('/admin/users')
def admin_users(page:int=Query(1,ge=1),size:int=Query(25,ge=1,le=100),_admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    items=db.scalars(select(User).order_by(User.created_at.desc(),User.id).offset((page-1)*size).limit(size)).all()
    return {'items':[{'id':u.id,'email':u.email,'role':u.role,'active':u.active,'created_at':u.created_at.isoformat()} for u in items],
            'page':page,'total':db.scalar(select(func.count()).select_from(User))}

@app.get('/admin/orders')
def admin_orders(page:int=Query(1,ge=1),size:int=Query(25,ge=1,le=100),_admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    records=db.execute(select(Order,User.email).join(User,User.id==Order.user_id).order_by(Order.created_at.desc(),Order.id).offset((page-1)*size).limit(size)).all()
    return {'items':[{'customer_email':email,**order_json(o)} for o,email in records],
            'page':page,'total':db.scalar(select(func.count()).select_from(Order))}

@app.get('/admin/summary')
def admin_summary(_admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    count_users=db.scalar(select(func.count()).select_from(User).where(User.role=='customer')) or 0
    count_orders=db.scalar(select(func.count()).select_from(Order)) or 0
    # Payment not integrated. This is gross value of UNPAID orders, not recognized revenue.
    placed_value=db.scalar(select(func.coalesce(func.sum(Order.total),0)))
    return {'customers':count_users,'orders':count_orders,'placed_order_value':str(placed_value),'currency':'INR','payments_collected':False}

@app.get('/admin/audit')
def admin_audit(page:int=Query(1,ge=1),size:int=Query(25,ge=1,le=100),_admin:User=Depends(admin_user),db:Session=Depends(get_db)):
    items=db.scalars(select(AuditLog).order_by(AuditLog.occurred_at.desc(),AuditLog.id).offset((page-1)*size).limit(size)).all()
    return {'items':[{'actor_id':r.actor_id,'action':r.action,'target_id':r.target_id,'occurred_at':r.occurred_at.isoformat()} for r in items], 'page':page}
