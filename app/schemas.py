from decimal import Decimal
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class Register(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
class Login(BaseModel):
    email: EmailStr
    password: str
class Refresh(BaseModel):
    refresh_token: str
class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    description: str = ''
    category: str = Field(min_length=1, max_length=80)
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
class StockIn(BaseModel):
    city: str = Field(min_length=2, max_length=80)
    quantity: int = Field(ge=0)
class CartIn(BaseModel):
    product_id: str
    city: str = Field(min_length=2, max_length=80)
    quantity: int = Field(ge=1, le=100)
class CheckoutIn(BaseModel):
    city: str = Field(min_length=2, max_length=80)
class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    sku: str
    name: str
    description: str
    category: str
    price: Decimal
    active: bool
class ProductPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(default=None, min_length=1, max_length=80)
    price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    active: bool | None = None
class FulfillmentStatus(BaseModel):
    status: str = Field(pattern='^(processing|shipped|delivered)$')

class RetailerApply(BaseModel):
    business_name: str = Field(min_length=3, max_length=160)
    gstin: str = Field(min_length=15, max_length=15)

class RetailerReview(BaseModel):
    status: str = Field(pattern='^(approved|rejected|suspended)$')
    review_note: str = Field(min_length=10,max_length=512)

class NewsletterIn(BaseModel):
    email: EmailStr
