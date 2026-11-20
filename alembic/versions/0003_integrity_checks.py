"""Enforce positive prices/quantities on existing installations.

0001 creates tables from current ORM metadata, which already has these checks
on fresh installations. This migration therefore skips constraints that exist.

Revision ID: 0003
Revises: 0002
"""
from alembic import op
from sqlalchemy import inspect
revision='0003'
down_revision='0002'
branch_labels=None
depends_on=None
constraints=[('products','ck_product_price_positive','price > 0'),
 ('inventory','ck_inventory_nonnegative','quantity >= 0'),
 ('cart_items','ck_cart_quantity_positive','quantity > 0 AND quantity <= 100'),
 ('orders','ck_order_total_nonnegative','total >= 0'),
 ('order_items','ck_order_item_quantity_positive','quantity > 0')]

def upgrade():
    inspector=inspect(op.get_bind())
    for table,name,expr in constraints:
        present={c['name'] for c in inspector.get_check_constraints(table)}
        if name not in present: op.create_check_constraint(name,table,expr)

def downgrade():
    inspector=inspect(op.get_bind())
    for table,name,_ in reversed(constraints):
        if name in {c['name'] for c in inspector.get_check_constraints(table)}:
            op.drop_constraint(name,table,type_='check')
