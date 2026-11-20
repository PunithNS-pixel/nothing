"""Retailer/GSTIN rules; format checks do NOT establish a registered taxpayer."""
import re
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import select
from app.config import get_settings
from app.models import RetailerProfile

ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
GST_PATTERN = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')

def gstin_checksum(base):
    """Luhn mod-36 checksum for a 14-character GSTIN prefix."""
    factor, total = 2, 0
    for char in reversed(base):
        value = ALPHABET.index(char) * factor
        total += (value // 36) + (value % 36)
        factor = 1 if factor == 2 else 2
    return ALPHABET[(-total) % 36]

def validate_gstin(value):
    value=value.strip().upper()
    if (not GST_PATTERN.fullmatch(value) or not 1 <= int(value[:2]) <= 38
            or gstin_checksum(value[:14]) != value[14]):
        raise ValueError('Invalid GSTIN structure or checksum')
    return value

def retailer_for(db, user_id):
    return db.scalar(select(RetailerProfile).where(RetailerProfile.user_id == user_id))

def retailer_approved(db, user_id):
    row=retailer_for(db, user_id)
    return row is not None and row.status == 'approved'

def price_for(product, approved):
    value=Decimal(str(product.price))
    percent=Decimal(str(get_settings().retailer_discount_percent)) if approved else Decimal('0')
    return (value * (Decimal('100') - percent) / Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
