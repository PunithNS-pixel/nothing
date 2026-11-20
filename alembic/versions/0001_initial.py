"""Initial schema for demo; all tables from declarative metadata.

Revision ID: 0001
Revises:
"""
from alembic import op
from app.db import Base
import app.models
revision='0001'
down_revision=None
branch_labels=None
depends_on=None

def upgrade():
    Base.metadata.create_all(bind=op.get_bind(), tables=[t for t in Base.metadata.sorted_tables if t.name != 'newsletter_subscribers'])
def downgrade():
    Base.metadata.drop_all(bind=op.get_bind(), tables=[t for t in Base.metadata.sorted_tables if t.name != 'newsletter_subscribers'])
