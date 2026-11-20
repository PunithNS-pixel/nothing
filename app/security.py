import hashlib, secrets
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.config import get_settings
from app.db import get_db
from app.models import User, RefreshToken

password_hasher = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

def hash_password(p: str) -> str: return password_hasher.hash(p)
def verify_password(p: str, h: str) -> bool: return password_hasher.verify(p, h)
def token_digest(token: str) -> str: return hashlib.sha256(token.encode()).hexdigest()

def access_token(user: User):
    s = get_settings(); now = datetime.now(timezone.utc)
    return jwt.encode({'sub': user.id, 'role': user.role, 'type': 'access', 'iss': s.jwt_issuer, 'iat': now, 'exp': now + timedelta(minutes=s.access_token_minutes)}, s.jwt_secret, algorithm='HS256')

def new_refresh(db: Session, user: User):
    raw = secrets.token_urlsafe(48)
    db.add(RefreshToken(user_id=user.id, token_hash=token_digest(raw), expires_at=datetime.now(timezone.utc) + timedelta(days=get_settings().refresh_token_days)))
    return raw

def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if credentials is None: raise HTTPException(401, 'Bearer token required', headers={'WWW-Authenticate': 'Bearer'})
    try:
        payload = jwt.decode(credentials.credentials, get_settings().jwt_secret, algorithms=['HS256'], issuer=get_settings().jwt_issuer)
        if payload.get('type') != 'access': raise ValueError('Wrong token type')
        user = db.get(User, payload['sub'])
        if not user or not user.active: raise ValueError('Inactive or missing user')
        return user
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, 'Invalid or expired token', headers={'WWW-Authenticate': 'Bearer'})

def admin_user(user: User = Depends(current_user)):
    if user.role != 'admin': raise HTTPException(403, 'Admin role required')
    return user
