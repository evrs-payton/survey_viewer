"""Assignments service for querying assignment overlays from PostgreSQL."""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Optional

import asyncpg

from .postgres import get_pool

logger = logging.getLogger(__name__)


async def get_overlays(
    site: str,
    band_start_hz: int,
    band_stop_hz: int,
    valid_on: Optional[date] = None,
) -> List[Dict]:
    """Get assignment overlays that overlap with the given frequency band.
    
    Args:
        site: Site name (required)
        band_start_hz: Band start frequency in Hz (BIGINT)
        band_stop_hz: Band stop frequency in Hz (BIGINT)
        valid_on: Optional date to filter active assignments (YYYY-MM-DD)
        
    Returns:
        List of assignment records with fields:
        - assignment_serial (str)
        - freq_start_hz (int)
        - freq_stop_hz (int)
        - center_frequency_hz (int)
        - bandwidth_hz (int)
        - source_name (str)
        
    Raises:
        RuntimeError: If database connection fails
    """
    pool = await get_pool()
    
    # Build query with overlap condition using int8range
    query = """
        SELECT 
            assignment_serial,
            freq_start_hz,
            freq_stop_hz,
            center_frequency_hz,
            bandwidth_hz,
            source_name
        FROM assignments
        WHERE site = $1
          AND freq_range && int8range($2, $3, '[]')
    """
    
    params: List = [site, band_start_hz, band_stop_hz]
    
    # Add valid_on date filter if provided
    if valid_on is not None:
        query += """
          AND (valid_from IS NULL OR valid_from <= $4)
          AND (valid_to IS NULL OR valid_to >= $4)
        """
        params.append(valid_on)
    
    query += " ORDER BY freq_start_hz"
    
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            
            return [
                {
                    "assignment_serial": row["assignment_serial"],
                    "freq_start_hz": row["freq_start_hz"],
                    "freq_stop_hz": row["freq_stop_hz"],
                    "center_frequency_hz": row["center_frequency_hz"],
                    "bandwidth_hz": row["bandwidth_hz"],
                    "source_name": row["source_name"],
                }
                for row in rows
            ]
    except asyncpg.exceptions.PostgresError as e:
        logger.error(f"PostgreSQL error in get_overlays: {e}", exc_info=True)
        raise RuntimeError(f"Database query failed: {str(e)}") from e
    except Exception as e:
        logger.error(f"Unexpected error in get_overlays: {e}", exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e

