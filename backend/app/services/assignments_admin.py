"""Administrative helpers for managing assignments (list sites, list by site, delete)."""

from __future__ import annotations

import logging
from typing import Dict, List

import asyncpg

from .postgres import get_pool

logger = logging.getLogger(__name__)


async def list_sites() -> List[str]:
    """Return distinct site names that currently have assignments."""
    pool = await get_pool()

    query = """
        SELECT DISTINCT site
        FROM assignments
        ORDER BY site
    """

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(query)
            return [row["site"] for row in rows]
    except asyncpg.exceptions.PostgresError as e:
        logger.error("PostgreSQL error in list_sites: %s", e, exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:  # pragma: no cover - unexpected
        logger.error("Unexpected error in list_sites: %s", e, exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e


async def list_assignments_for_site(site: str) -> List[Dict]:
    """List all assignments for a given site."""
    pool = await get_pool()

    query = """
        SELECT
            id,
            site,
            assignment_serial,
            source_name,
            center_frequency_hz,
            bandwidth_hz,
            freq_start_hz,
            freq_stop_hz,
            latitude,
            longitude,
            valid_from,
            valid_to,
            ingested_at_utc
        FROM assignments
        WHERE site = $1
        ORDER BY assignment_serial, freq_start_hz
    """

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, site)
            return [
                {
                    "id": row["id"],
                    "site": row["site"],
                    "assignment_serial": row["assignment_serial"],
                    "source_name": row["source_name"],
                    "center_frequency_hz": row["center_frequency_hz"],
                    "bandwidth_hz": row["bandwidth_hz"],
                    "freq_start_hz": row["freq_start_hz"],
                    "freq_stop_hz": row["freq_stop_hz"],
                    "latitude": row["latitude"],
                    "longitude": row["longitude"],
                    "valid_from": row["valid_from"].isoformat() if row["valid_from"] else None,
                    "valid_to": row["valid_to"].isoformat() if row["valid_to"] else None,
                    "ingested_at_utc": row["ingested_at_utc"].isoformat()
                    if row["ingested_at_utc"]
                    else None,
                }
                for row in rows
            ]
    except asyncpg.exceptions.PostgresError as e:
        logger.error("PostgreSQL error in list_assignments_for_site: %s", e, exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:  # pragma: no cover - unexpected
        logger.error(
            "Unexpected error in list_assignments_for_site: %s", e, exc_info=True
        )
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e


async def delete_assignment(assignment_id: int) -> bool:
    """Delete a single assignment by primary key.

    Returns True if a row was deleted, False if not found.
    """
    pool = await get_pool()

    query = "DELETE FROM assignments WHERE id = $1"

    try:
        async with pool.acquire() as conn:
            result: str = await conn.execute(query, assignment_id)
            # asyncpg returns strings like "DELETE 0" or "DELETE 1"
            try:
                affected = int(result.split()[-1])
            except (ValueError, IndexError):
                logger.warning("Unexpected DELETE result in delete_assignment: %s", result)
                affected = 0
            return affected > 0
    except asyncpg.exceptions.PostgresError as e:
        logger.error("PostgreSQL error in delete_assignment: %s", e, exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:  # pragma: no cover - unexpected
        logger.error("Unexpected error in delete_assignment: %s", e, exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e

