from decimal import Decimal
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Product, Inventory, User, Outbox
from app.security import hash_password
from app.config import get_settings

# These are demonstration INR prices, NOT live product prices. Edit in admin API.
examples=[
 ('COFFEE-ORIGINAL','Original Black','Bold Colombian coffee. Smooth cold brew, 12-pack.','Coffee','4599.00'),
 ('COFFEE-VANILLA','Toasted Vanilla','Toasted vanilla flavored cold brew, 12-pack.','Coffee','4599.00'),
 ('COFFEE-MOCHA','Smooth Mocha','Cold brew with cocoa notes, 12-pack.','Coffee','4599.00'),
 ('COFFEE-VARIETY','Variety Pack','Mixed flavors cold brew, 12-pack.','Coffee','4799.00'),
]
with SessionLocal() as db:
    s=get_settings()
    if s.admin_password and not db.scalar(select(User).where(User.email==s.admin_email)):
        db.add(User(email=s.admin_email,password_hash=hash_password(s.admin_password),role='admin'))
    for sku,name,description,category,price in examples:
        p=db.scalar(select(Product).where(Product.sku==sku))
        if not p:
            p=Product(sku=sku,name=name,description=description,category=category,price=Decimal(price))
            db.add(p);db.flush()
            for city,count in [('Bengaluru',40),('Mumbai',30),('Delhi',25)]:
                db.add(Inventory(product_id=p.id,city=city,quantity=count))
            db.add(Outbox(event_type='product.changed',aggregate_id=p.id,payload={'product_id':p.id}))
    db.commit()
print('Coffee catalog seeded. Admin login:',get_settings().admin_email)
