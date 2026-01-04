"""PostgreSQL connection service for assignments data."""

from __future__ import annotations

import os
from typing import Optional

import asyncpg


_pool: Optional[asyncpg.Pool] = None


def _required(name: str) -> str:
    """Get required environment variable or raise RuntimeError."""
    val = os.getenv(name)
    if not val:
        raise RuntimeError(f"Environment variable {name} is required for PostgreSQL access.")
    return val


async def get_pool() -> asyncpg.Pool:
    """Get or create PostgreSQL connection pool.
    
    Returns:
        AsyncPG connection pool
        
    Raises:
        RuntimeError: If required environment variables are missing
    """
    global _pool
    
    if _pool is None:
        host = _required("PGHOST")
        port = int(os.getenv("PGPORT", "5432"))
        database = _required("PGDATABASE")
        user = _required("PGUSER")
        password = _required("PGPASSWORD")
        
        _pool = await asyncpg.create_pool(
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            min_size=1,
            max_size=10,
        )
    
    return _pool


async def close_pool() -> None:
    """Close the PostgreSQL connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None

