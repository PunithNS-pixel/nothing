"""Create retailer applications and approval state.

Revision ID: 0004
Revises: 0003
"""
from alembic import op
from sqlalchemy import inspect
from app.models import RetailerProfile
revision='0004'
down_revision='0003'
branch_labels=None
depends_on=None

def upgrade():
    RetailerProfile.__table__.create(bind=op.get_bind(), checkfirst=True)

def downgrade():
    if inspect(op.get_bind()).has_table('retailer_profiles'):
        op.drop_table('retailer_profiles')
