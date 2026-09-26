from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)


class Base(DeclarativeBase):
    pass


def create_database(database_url: str | None = None) -> tuple[Engine, sessionmaker]:
    is_production = os.getenv("KAITEN_ENV", "development").lower() == "production"
    use_supabase = is_production or os.getenv("KAITEN_DATABASE_TARGET", "local").lower() == "supabase"
    if database_url:
        url = database_url
    elif use_supabase:
        url = (
            os.getenv("KAITEN_SUPABASE_SESSION_POOLER_URL")
            or os.getenv("KAITEN_SUPABASE_DATABASE_URL")
            or os.getenv("KAITEN_DATABASE_URL", "sqlite:///./kaiten.db")
        )
    else:
        url = os.getenv("KAITEN_DATABASE_URL", "sqlite:///./kaiten.db")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)

    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)
    return engine, sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)