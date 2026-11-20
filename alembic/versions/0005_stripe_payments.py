"""Stripe payment state and reservations; existing orders remain unpaid COD.

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
revision='0005'
down_revision='0004'
branch_labels=None
depends_on=None

columns=(
 ('payment_method', sa.Column('payment_method',sa.String(16),nullable=False,server_default='cod')),
 ('payment_status', sa.Column('payment_status',sa.String(24),nullable=False,server_default='unpaid')),
 ('stripe_session_id', sa.Column('stripe_session_id',sa.String(255),nullable=True)),
 ('stripe_payment_intent_id',sa.Column('stripe_payment_intent_id',sa.String(255),nullable=True)),
 ('stripe_checkout_url',sa.Column('stripe_checkout_url',sa.Text(),nullable=True)),
 ('reserved_until',sa.Column('reserved_until',sa.DateTime(timezone=True),nullable=True)),
)

def upgrade():
    bound=op.get_bind()
    have={c['name'] for c in inspect(bound).get_columns('orders')}
    for name,column in columns:
        if name not in have: op.add_column('orders',column)
    indexes={i['name'] for i in inspect(bound).get_indexes('orders')}
    if 'ix_orders_stripe_session_id' not in indexes:
        op.create_index('ix_orders_stripe_session_id','orders',['stripe_session_id'],unique=True)

def downgrade():
    op.drop_index('ix_orders_stripe_session_id',table_name='orders')
    for name,_ in reversed(columns): op.drop_column('orders',name)
