"""Stripe-hosted Checkout integration.

PostgreSQL remains authoritative for stock and orders. Reservations are taken
atomically before requesting a hosted session; only verified Stripe webhooks
mark orders paid and emit order.placed events. Expired sessions are reconciled
by workers.stripe_reservations, including when a webhook was delayed.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import logging
import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.models import User, Product, Inventory, CartItem, Order, OrderItem, Outbox, AuditLog
from app.schemas import CheckoutIn
from app.security import current_user
from app.retailers import retailer_approved, price_for

router = APIRouter(tags=['payments'])
logger = logging.getLogger('nothing.payments')
RESERVATION_MINUTES = 31


def as_plain(value):
    """Stripe SDK returns StripeObject, which is not a Python dict (no .get)."""
    if isinstance(value, dict): return value
    if hasattr(value, 'to_dict_recursive'): return value.to_dict_recursive()
    if hasattr(value, 'to_dict'): return value.to_dict()
    raise TypeError('Unsupported Stripe response type')


def utcnow():
    return datetime.now(timezone.utc)


def epoch_paise(amount):
    return int((Decimal(amount) * 100).to_integral_exact())


def assert_stripe_config():
    s = get_settings()
    if not (s.stripe_secret_key.startswith(('sk_test_', 'sk_live_')) and s.stripe_webhook_secret.startswith('whsec_')):
        raise HTTPException(503, 'Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to .env.')
    if s.environment == 'production' and not s.public_base_url.startswith('https://'):
        raise HTTPException(503, 'PUBLIC_BASE_URL must use HTTPS in production')
    stripe.api_key = s.stripe_secret_key
    return s


def _event(db, name, order_id, payload):
    db.add(Outbox(event_type=name, aggregate_id=order_id, payload=payload))


def _state_json(o):
    return {'order_id': o.id, 'payment_method': o.payment_method, 'payment_status': o.payment_status,
            'status': o.status, 'total': str(o.total), 'currency': 'INR',
            'checkout_url': o.stripe_checkout_url if o.payment_status == 'pending' else None}


def _release_locked(db, o, payment_status):
    """Requires a PostgreSQL FOR UPDATE lock on the order row."""
    if o.payment_method != 'stripe' or o.payment_status != 'pending':
        return False
    ids = sorted({item.product_id for item in o.items})
    stock_rows = db.scalars(select(Inventory).where(Inventory.product_id.in_(ids), Inventory.city == o.city)
                            .order_by(Inventory.product_id).with_for_update()).all()
    stock = {r.product_id: r for r in stock_rows}
    for item in o.items:
        row = stock.get(item.product_id)
        if row is None:
            # Never lose a refund/stock-recovery event: halt and retry.
            raise RuntimeError('Reserved inventory row is missing for ' + item.product_id)
        row.quantity += item.quantity
        _event(db, 'inventory.changed', item.product_id,
               {'product_id': item.product_id, 'city': o.city, 'quantity': row.quantity})
    o.payment_status = payment_status
    o.status = 'payment_' + payment_status
    o.stripe_checkout_url = None
    _event(db, 'payment.' + payment_status, o.id,
           {'order_id': o.id, 'payment_status': payment_status})
    db.add(AuditLog(actor_id=o.user_id, action='payment.' + payment_status, target_id=o.id))
    return True


def _paid_locked(db, o, session):
    """Requires a PostgreSQL FOR UPDATE lock on the order row."""
    if o.payment_method != 'stripe' or o.payment_status != 'pending':
        if o.payment_status in ('expired','failed') and session.get('payment_status') == 'paid':
            raise ValueError('Late paid Stripe event after stock release; requires urgent refund/reconciliation')
        return False
    if str(session.get('currency', '')).lower() != 'inr' or session.get('amount_total') != epoch_paise(o.total):
        raise ValueError('Stripe amount/currency mismatch; payment requires manual reconciliation')
    if session.get('payment_status') != 'paid':
        return False
    sid = session.get('id')
    if o.stripe_session_id and o.stripe_session_id != sid:
        raise ValueError('Stripe session ID does not match order')
    o.stripe_session_id = sid
    payment_intent = session.get('payment_intent')
    o.stripe_payment_intent_id = payment_intent.get('id') if isinstance(payment_intent, dict) else payment_intent
    o.payment_status = 'paid'
    o.status = 'placed'
    o.stripe_checkout_url = None
    # Remove only cart lines still matching the original reservation; do not
    # discard changes customers made while redirected to hosted Checkout.
    for item in o.items:
        cart = db.scalar(select(CartItem).where(CartItem.user_id == o.user_id,
                CartItem.product_id == item.product_id, CartItem.city == o.city).with_for_update())
        if cart and cart.quantity == item.quantity:
            db.delete(cart)
    _event(db, 'payment.succeeded', o.id, {'order_id': o.id, 'amount': str(o.total)})
    _event(db, 'order.placed', o.id, {
        'order_id': o.id, 'user_id': o.user_id, 'city': o.city, 'total': str(o.total),
        'items': [{'product_id': i.product_id, 'quantity': i.quantity, 'price': str(i.price)} for i in o.items]
    })
    db.add(AuditLog(actor_id=o.user_id, action='payment.succeeded', target_id=o.id))
    return True


def reconcile_stripe_session(db, session, event_type):
    """Idempotent webhook/reconciliation update, transactionally locked."""
    oid = (session.get('metadata') or {}).get('order_id') or session.get('client_reference_id')
    if not oid:
        raise ValueError('Missing order reference')
    o = db.scalar(select(Order).where(Order.id == oid).with_for_update())
    if not o or o.payment_method != 'stripe':
        raise ValueError('Stripe event references unknown order')
    if o.stripe_session_id and o.stripe_session_id != session.get('id'):
        raise ValueError('Stripe event references a different Checkout Session')
    if event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded'):
        _paid_locked(db, o, session)
    elif event_type in ('checkout.session.expired', 'checkout.session.async_payment_failed'):
        # Even for failure events, never release a verified paid order.
        if session.get('payment_status') == 'paid':
            _paid_locked(db,o,session)
        elif o.payment_status == 'pending':
            _release_locked(db, o, 'expired' if event_type.endswith('expired') else 'failed')
    db.commit()
    return _state_json(o)


def _reserve(db, user, city, key):
    db.execute(select(User).where(User.id == user.id).with_for_update()).scalar_one()
    prior = db.scalar(select(Order).where(Order.user_id == user.id, Order.idempotency_key == key))
    if prior:
        if prior.payment_method != 'stripe' or prior.city != city:
            raise HTTPException(409, 'Idempotency key already used for a different checkout')
        if prior.payment_status != 'pending':
            raise HTTPException(409, 'This payment attempt is already finalized. Use a new checkout key.')
        return prior
    other = db.scalar(select(Order.id).where(Order.user_id == user.id, Order.payment_method == 'stripe',
                     Order.payment_status == 'pending').limit(1))
    if other:
        raise HTTPException(409, 'Another Stripe payment is pending. Complete it or cancel it in My Orders.')
    items = db.scalars(select(CartItem).where(CartItem.user_id == user.id, CartItem.city == city)
                       .order_by(CartItem.product_id).with_for_update()).all()
    if not items:
        raise HTTPException(400, 'Your cart is empty for this city')
    ids = sorted({item.product_id for item in items})
    products = {p.id: p for p in db.scalars(select(Product).where(Product.id.in_(ids))
                                          .order_by(Product.id).with_for_update())}
    stocks = {r.product_id: r for r in db.scalars(select(Inventory).where(Inventory.product_id.in_(ids),
                                       Inventory.city == city).order_by(Inventory.product_id).with_for_update())}
    for item in items:
        p,stock = products.get(item.product_id), stocks.get(item.product_id)
        if not p or not p.active or not stock or stock.quantity < item.quantity:
            raise HTTPException(409, 'Insufficient stock for ' + item.product_id)
    approved = retailer_approved(db, user.id, lock=True)
    total = sum((price_for(products[item.product_id], approved) * item.quantity for item in items), Decimal('0.00'))
    o = Order(user_id=user.id, idempotency_key=key, city=city, total=total, status='payment_pending',
              payment_method='stripe', payment_status='pending', reserved_until=utcnow()+timedelta(minutes=RESERVATION_MINUTES))
    db.add(o)
    db.flush()
    for item in items:
        p = products[item.product_id]
        unit = price_for(p, approved)
        db.add(OrderItem(order_id=o.id, product_id=p.id, name=p.name, price=unit, quantity=item.quantity))
        stocks[p.id].quantity -= item.quantity
        _event(db, 'inventory.changed', p.id, {'product_id': p.id, 'city':city,'quantity':stocks[p.id].quantity})
    db.add(AuditLog(actor_id=user.id,action='payment.reserve',target_id=o.id))
    db.commit()
    db.refresh(o)
    return o


def _create_session(o, email, key, config):
    base = config.public_base_url.rstrip('/')
    expires = o.reserved_until
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= utcnow() + timedelta(minutes=1):
        raise HTTPException(409, 'Payment reservation expired. Cancel the old attempt and try again.')
    # Price and line items come from saved DB snapshots, not request content.
    return stripe.checkout.Session.create(
        mode='payment', payment_method_types=['card'], currency='inr',
        customer_email=email, client_reference_id=o.id,
        metadata={'order_id':o.id, 'user_id':o.user_id},
        line_items=[{'price_data':{'currency':'inr','unit_amount':epoch_paise(i.price),
                   'product_data':{'name':i.name}},'quantity':i.quantity} for i in o.items],
        expires_at=int(expires.timestamp()),
        success_url=base+'/?stripe=success&order_id='+o.id+'&session_id={CHECKOUT_SESSION_ID}',
        cancel_url=base+'/?stripe=cancel&order_id='+o.id,
        idempotency_key='nothing-checkout-'+o.id,
    )


@router.get('/payments/stripe/config')
def stripe_public_config():
    s=get_settings()
    return {'enabled':bool(s.stripe_secret_key and s.stripe_webhook_secret), 'currency':'INR', 'test_mode':s.stripe_secret_key.startswith('sk_test_')}


@router.post('/payments/stripe/checkout', status_code=201)
def begin_stripe_checkout(data: CheckoutIn,
     idempotency_key: str = Header(...,alias='Idempotency-Key',min_length=8,max_length=128),
     user: User = Depends(current_user), db: Session = Depends(get_db)):
    config=assert_stripe_config()
    o=_reserve(db,user,data.city,idempotency_key)
    if o.stripe_checkout_url:
        return _state_json(o)
    try:
        session=as_plain(_create_session(o,user.email,idempotency_key,config))
        if not session.get('url') or not session.get('id'):
            raise RuntimeError('Stripe did not return a Checkout Session URL')
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception('Stripe Checkout session creation failed for %s',o.id)
        # An ambiguous provider error may have created a session; never restore
        # stock until Stripe confirms expiry or failure. Retrying with the same
        # key reuses Stripe's idempotency key.
        raise HTTPException(502, 'Stripe payment setup failed. Retry the same checkout; inventory remains temporarily reserved.') from exc
    locked = db.scalar(select(Order).where(Order.id == o.id).with_for_update())
    if locked.payment_status != 'pending':
        db.commit()
        raise HTTPException(409, 'Payment state changed while creating session; refresh orders')
    locked.stripe_session_id=session['id']
    locked.stripe_checkout_url=session['url']
    db.commit()
    return _state_json(locked)


@router.get('/payments/stripe/orders/{order_id}')
def get_payment_status(order_id: str, user: User=Depends(current_user), db:Session=Depends(get_db)):
    o=db.get(Order,order_id)
    if not o or o.user_id!=user.id: raise HTTPException(404,'Order not found')
    return _state_json(o)


@router.post('/payments/stripe/orders/{order_id}/cancel')
def cancel_payment(order_id: str,user:User=Depends(current_user),db:Session=Depends(get_db)):
    config=assert_stripe_config()
    o=db.get(Order,order_id)
    if not o or o.user_id!=user.id or o.payment_method!='stripe':
        raise HTTPException(404,'Stripe order not found')
    if o.payment_status != 'pending': return _state_json(o)
    if o.stripe_session_id:
        try:
            session=as_plain(stripe.checkout.Session.retrieve(o.stripe_session_id))
            if session.get('payment_status')=='paid':
                return reconcile_stripe_session(db,session,'checkout.session.completed')
            if session.get('status')=='open':
                session=as_plain(stripe.checkout.Session.expire(o.stripe_session_id))
            if session.get('status')!='expired':
                raise HTTPException(409,'Payment is being processed; stock cannot be released yet')
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception('Stripe cancellation failed for %s',o.id)
            raise HTTPException(503,'Could not verify Stripe cancellation. Retry later.') from exc
    locked=db.scalar(select(Order).where(Order.id==o.id).with_for_update())
    _release_locked(db,locked,'expired')
    db.commit()
    return _state_json(locked)


@router.post('/payments/stripe/webhook')
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    config=assert_stripe_config()
    payload=await request.body()
    if len(payload)>1024*1024: raise HTTPException(413, 'Webhook body too large')
    signature=request.headers.get('stripe-signature','')
    try:
        evt=as_plain(stripe.Webhook.construct_event(payload,signature,config.stripe_webhook_secret))
    except (ValueError,stripe.error.SignatureVerificationError):
        raise HTTPException(400, 'Invalid webhook signature or payload')
    typ=evt.get('type')
    allowed={'checkout.session.completed','checkout.session.async_payment_succeeded',
             'checkout.session.async_payment_failed','checkout.session.expired'}
    if typ not in allowed: return {'received':True}
    session=as_plain(evt['data']['object'])
    try:
        reconcile_stripe_session(db,session,typ)
    except ValueError:
        logger.exception('Stripe webhook order/amount validation failure: event=%s',evt.get('id'))
        raise HTTPException(400,'Checkout event failed validation')
    except Exception:
        logger.exception('Stripe webhook processing failed: event=%s',evt.get('id'))
        raise HTTPException(503,'Webhook processing delayed; Stripe should retry')
    return {'received':True}
