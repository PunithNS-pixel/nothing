"""Idempotent seed for Nothing Energy. Demo values are not retail guarantees."""
from decimal import Decimal
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Product, Inventory, User, Outbox
from app.security import hash_password
from app.config import get_settings

# A Five-Flavor Mix is a PREPACKAGED SKU with its own stock, not assembled
# automatically from individual cans. This keeps inventory accounting explicit.
products = [
    ('ENERGY-ORIGINAL','Original','250ml original energy drink; classic dark blue and silver can.','Energy Drinks','149.00'),
    ('ENERGY-SUGARFREE','Sugar Free','250ml sugar-free energy drink; light blue and silver can.','Energy Drinks','149.00'),
    ('ENERGY-GREEN','Green Edition','250ml curuba and elderflower edition.','Energy Drinks','169.00'),
    ('ENERGY-PINK','Pink Edition','250ml white peach edition.','Energy Drinks','169.00'),
    ('ENERGY-RED','Red Edition','250ml watermelon edition.','Energy Drinks','169.00'),
    ('ENERGY-MIX','Five-Flavor Mix','Prepacked mixed five-can set, one can of each edition.','Energy Drinks','799.00'),
]
with SessionLocal() as db:
    s=get_settings()
    admin_email=s.admin_email.strip().lower()
    if not s.admin_password or s.admin_password.startswith('REPLACE_') or len(s.admin_password)<12:
        raise RuntimeError('Set ADMIN_PASSWORD in .env to a strong password (12+ characters) before running seed')
    admin=db.scalar(select(User).where(User.email==admin_email))
    if not admin:
        db.add(User(email=admin_email,password_hash=hash_password(s.admin_password),role='admin'))
    elif admin.role!='admin':
        raise RuntimeError('ADMIN_EMAIL belongs to an existing non-admin account. Use a separate admin email.')
    # Deactivate legacy coffee demo catalog without deleting historical orders.
    for legacy in db.scalars(select(Product).where(Product.sku.like('COFFEE-%'), Product.active.is_(True))).all():
        legacy.active=False
        db.add(Outbox(event_type='product.changed',aggregate_id=legacy.id,payload={'product_id':legacy.id}))
    for sku,name,description,category,price in products:
        product=db.scalar(select(Product).where(Product.sku==sku))
        if product is None:
            product=Product(sku=sku,name=name,description=description,category=category,price=Decimal(price))
            db.add(product);db.flush()
            for city,count in [('Bengaluru',80),('Mumbai',60),('Delhi',50)]:
                db.add(Inventory(product_id=product.id,city=city,quantity=12 if sku=='ENERGY-MIX' else count))
            db.add(Outbox(event_type='product.changed',aggregate_id=product.id,payload={'product_id':product.id}))
    db.commit()
print('Energy catalog seeded (six SKUs). Admin:', admin_email)
