from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
UTC = getattr(datetime, 'UTC', timezone.utc)
from uuid import UUID

import jwt
from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from app.models import Role, User

password_hash = PasswordHash.recommended()


def _jwt_secret() -> str:
    secret = os.getenv("KAITEN_JWT_SECRET")
    if secret:
        return secret
    if os.getenv("KAITEN_ENV", "development").lower() == "production":
        raise RuntimeError("KAITEN_JWT_SECRET must be configured in production.")
    return "local-development-secret-change-before-deployment"


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def create_access_token(user: User) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": str(user.id), "iat": now, "exp": now + timedelta(hours=8)},
        _jwt_secret(),
        algorithm="HS256",
    )


def get_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None, db: Session
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to access this resource.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(credentials.credentials, _jwt_secret(), algorithms=["HS256"])
        user_id = UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account is unavailable.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_role(user: User, *allowed_roles: Role) -> None:
    if user.role is not Role.ADMIN and user.role not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your role cannot perform this action.")