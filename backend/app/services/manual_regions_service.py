"""Manual regions service for CRUD operations on manual regions in PostgreSQL."""

from __future__ import annotations

import logging
from typing import Dict, List, Optional
from uuid import UUID

import asyncpg

from .postgres import get_pool

logger = logging.getLogger(__name__)


async def get_regions(
    site: str,
    band_start_hz: int,
    band_stop_hz: int,
) -> List[Dict]:
    """Get manual regions that overlap with the given frequency band.
    
    Args:
        site: Site name (required)
        band_start_hz: Band start frequency in Hz (BIGINT)
        band_stop_hz: Band stop frequency in Hz (BIGINT)
        
    Returns:
        List of manual region records with fields:
        - id (str, UUID)
        - site (str)
        - freq_start_hz (int)
        - freq_stop_hz (int)
        - label (str or None)
        - color (str or None)
        - created_by (str or None)
        - created_at_utc (str, ISO format)
        
    Raises:
        RuntimeError: If database connection fails
    """
    pool = await get_pool()
    
    # Query with range overlap: regions overlap if freq_start <= band_stop AND freq_stop >= band_start
    query = """
        SELECT 
            id,
            site,
            freq_start_hz,
            freq_stop_hz,
            label,
            color,
            created_by,
            created_at_utc
        FROM manual_regions
        WHERE site = $1
          AND freq_start_hz <= $3
          AND freq_stop_hz >= $2
        ORDER BY freq_start_hz
    """
    
    params: List = [site, band_start_hz, band_stop_hz]
    
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            
            return [
                {
                    "id": str(row["id"]),
                    "site": row["site"],
                    "freq_start_hz": row["freq_start_hz"],
                    "freq_stop_hz": row["freq_stop_hz"],
                    "label": row["label"],
                    "color": row["color"],
                    "created_by": row["created_by"],
                    "created_at_utc": row["created_at_utc"].isoformat() if row["created_at_utc"] else None,
                }
                for row in rows
            ]
    except asyncpg.exceptions.PostgresError as e:
        logger.error(f"PostgreSQL error in get_regions: {e}", exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:
        logger.error(f"Unexpected error in get_regions: {e}", exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e


async def create_region(
    site: str,
    freq_start_hz: int,
    freq_stop_hz: int,
    label: Optional[str] = None,
    color: Optional[str] = None,
) -> Dict:
    """Create a new manual region.
    
    Args:
        site: Site name (required)
        freq_start_hz: Region start frequency in Hz (BIGINT)
        freq_stop_hz: Region stop frequency in Hz (BIGINT)
        label: Optional label for the region
        color: Optional color (defaults to 'rgba(255, 200, 0, 0.3)')
        
    Returns:
        Created region record with all fields including UUID
        
    Raises:
        RuntimeError: If database connection fails
        ValueError: If validation fails (freq_start_hz > freq_stop_hz)
    """
    if freq_start_hz > freq_stop_hz:
        raise ValueError("freq_start_hz must be <= freq_stop_hz")
    
    pool = await get_pool()
    
    # Use default color if not provided
    final_color = color or 'rgba(255, 200, 0, 0.3)'
    
    query = """
        INSERT INTO manual_regions (site, freq_start_hz, freq_stop_hz, label, color)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, site, freq_start_hz, freq_stop_hz, label, color, created_by, created_at_utc
    """
    
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, site, freq_start_hz, freq_stop_hz, label, final_color)
            
            if row is None:
                raise RuntimeError("Failed to create manual region")
            
            return {
                "id": str(row["id"]),
                "site": row["site"],
                "freq_start_hz": row["freq_start_hz"],
                "freq_stop_hz": row["freq_stop_hz"],
                "label": row["label"],
                "color": row["color"],
                "created_by": row["created_by"],
                "created_at_utc": row["created_at_utc"].isoformat() if row["created_at_utc"] else None,
            }
    except asyncpg.exceptions.PostgresError as e:
        logger.error(f"PostgreSQL error in create_region: {e}", exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:
        logger.error(f"Unexpected error in create_region: {e}", exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e


async def delete_region(region_id: str) -> bool:
    """Delete a manual region by UUID.
    
    Args:
        region_id: UUID of the region to delete
        
    Returns:
        True if region was deleted, False if not found
        
    Raises:
        RuntimeError: If database connection fails
        ValueError: If region_id is not a valid UUID
    """
    try:
        uuid_obj = UUID(region_id)
    except ValueError:
        raise ValueError(f"Invalid UUID format: {region_id}")
    
    pool = await get_pool()
    
    query = """
        DELETE FROM manual_regions
        WHERE id = $1
    """
    
    try:
        async with pool.acquire() as conn:
            result = await conn.execute(query, uuid_obj)
            # result is a string like "DELETE 1" or "DELETE 0"
            deleted_count = int(result.split()[-1]) if result else 0
            return deleted_count > 0
    except asyncpg.exceptions.PostgresError as e:
        logger.error(f"PostgreSQL error in delete_region: {e}", exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:
        logger.error(f"Unexpected error in delete_region: {e}", exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e
