"""Recover Stripe reservations after timeout, lost webhooks, or process crashes.

Never release an open or completed Checkout Session without first consulting
Stripe: a delayed payment webhook must not lead to product overselling.
"""
import logging
import time
from datetime import datetime, timezone
import stripe
from sqlalchemy import select
from app.db import SessionLocal
from app.config import get_settings
from app.models import Order
from app.payments import _release_locked, reconcile_stripe_session
logging.basicConfig(level=logging.INFO)
logger=logging.getLogger('nothing.stripe.reconciler')


def reconcile_once():
    config=get_settings()
    if not config.stripe_secret_key: return 0
    stripe.api_key=config.stripe_secret_key
    with SessionLocal() as db:
        # Look at expired reservations, including interrupted Stripe session setup.
        due=db.scalars(select(Order).where(Order.payment_method=='stripe',Order.payment_status=='pending',
                     Order.reserved_until <= datetime.now(timezone.utc)).order_by(Order.reserved_until).limit(40)).all()
        ids=[o.id for o in due]
    done=0
    for oid in ids:
        try:
            with SessionLocal() as db:
                o=db.get(Order,oid)
                if not o or o.payment_status!='pending':continue
                if not o.stripe_session_id:
                    # A network interruption could have created the session at Stripe
                    # before we saved its ID. Do NOT release stock without verification.
                    logger.error('Order %s has an ambiguous Stripe session; verify it manually before releasing stock',oid)
                    continue
                if o.stripe_session_id:
                    session=stripe.checkout.Session.retrieve(o.stripe_session_id)
                    if session.get('payment_status')=='paid':
                        reconcile_stripe_session(db,session,'checkout.session.completed');done+=1;continue
                    if session.get('status')=='open':
                        session=stripe.checkout.Session.expire(o.stripe_session_id)
                    if session.get('status')!='expired':
                        logger.warning('Order %s is not paid but cannot be expired; manual investigation required',oid)
                        continue
                locked=db.scalar(select(Order).where(Order.id==oid).with_for_update())
                if _release_locked(db,locked,'expired'):
                    db.commit();done+=1
        except Exception:
            logger.exception('Stripe reservation reconciliation failed: order=%s',oid)
    return done

if __name__=='__main__':
    while True:
        try: reconcile_once()
        except Exception: logger.exception('Stripe reconciliation cycle failed')
        time.sleep(60)
