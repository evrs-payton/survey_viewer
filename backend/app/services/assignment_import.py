"""Assignment import service for loading assignments into PostgreSQL."""

from __future__ import annotations

import logging
import math
import re
from datetime import date
from typing import Dict, List, Optional

import asyncpg

from .postgres import get_pool

logger = logging.getLogger(__name__)


async def import_assignments(
    site: str,
    source_name: str,
    assignments: List[Dict],
) -> Dict:
    """Import assignment records into PostgreSQL.
    
    This function is intentionally minimal—it only stores the minimum overlay fields
    needed for visualization. It does not store station classes, emissions, power,
    comments, equipment, or other classification-sensitive data.
    
    Args:
        site: Site name (required, user-provided)
        source_name: Source name (e.g., "SFAF")
        assignments: List of assignment dictionaries with fields:
            - agency_serial (str, required) - mapped to assignment_serial in database
            - center_frequency_hz (int, required)
            - bandwidth_hz (int, required, must be > 0)
            - latitude (float, optional)
            - longitude (float, optional)
            - valid_from (str YYYY-MM-DD, optional)
            - review_date (str YYYY-MM-DD, optional)
            - expiration_date (str YYYY-MM-DD, optional)
            Note: valid_to is derived from expiration_date (if present) or review_date (if present)
            
    Returns:
        Dictionary with:
            - inserted (int): Number of assignments inserted
            - skipped (int): Number of assignments skipped (duplicates)
            - errors (List[Dict]): List of error dictionaries with:
                - index (int): Index in assignments array
                - assignment_serial (str): Assignment serial
                - error (str): Error message
                
    Raises:
        RuntimeError: If database connection fails
    """
    logger.info(f"Starting import for site={site}, source_name={source_name}, assignments={len(assignments)}")
    
    pool = await get_pool()
    
    inserted_count = 0
    skipped_count = 0
    errors: List[Dict] = []
    
    # SQL query with ON CONFLICT DO NOTHING
    insert_query = """
        INSERT INTO assignments (
            site, assignment_serial, source_name,
            center_frequency_hz, bandwidth_hz,
            freq_start_hz, freq_stop_hz,
            latitude, longitude, valid_from, valid_to
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (site, assignment_serial) DO NOTHING
    """
    
    try:
        async with pool.acquire() as conn:
            for index, assignment in enumerate(assignments):
                # Map agency_serial from input to assignment_serial for database
                agency_serial = assignment.get("agency_serial")
                assignment_serial = agency_serial  # Use agency_serial as assignment_serial
                center_frequency_hz = assignment.get("center_frequency_hz")
                bandwidth_hz = assignment.get("bandwidth_hz")
                latitude = assignment.get("latitude")
                longitude = assignment.get("longitude")
                valid_from_str = assignment.get("valid_from")
                # Derive valid_to from review_date or expiration_date (prefer expiration_date if both present)
                review_date_str = assignment.get("review_date")
                expiration_date_str = assignment.get("expiration_date")
                valid_to_str = expiration_date_str if expiration_date_str else review_date_str
                
                # Validate required fields
                if not assignment_serial:
                    errors.append({
                        "index": index,
                        "assignment_serial": str(assignment_serial) if assignment_serial else "",
                        "error": "agency_serial is required",
                    })
                    continue
                
                if center_frequency_hz is None:
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": "center_frequency_hz is required",
                    })
                    continue
                
                if bandwidth_hz is None:
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": "bandwidth_hz is required",
                    })
                    continue
                
                # Validate values
                if center_frequency_hz <= 0:
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": "center_frequency_hz must be > 0",
                    })
                    continue
                
                if bandwidth_hz <= 0:
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": "bandwidth_hz must be > 0",
                    })
                    continue
                
                # Derive frequency bounds using floor/ceil to avoid off-by-one errors
                freq_start_hz = center_frequency_hz - math.floor(bandwidth_hz / 2)
                freq_stop_hz = center_frequency_hz + math.ceil(bandwidth_hz / 2)
                
                # Parse dates if provided (handle both YYYY-MM-DD and ISO timestamp formats)
                def parse_date_string(date_str: str) -> date:
                    """Parse date string, handling both YYYY-MM-DD and ISO timestamp formats."""
                    # If it contains 'T' or space, it's likely an ISO timestamp - extract date part
                    if 'T' in date_str:
                        date_str = date_str.split('T')[0]
                    elif ' ' in date_str:
                        date_str = date_str.split(' ')[0]
                    return date.fromisoformat(date_str)
                
                valid_from_date: Optional[date] = None
                if valid_from_str:
                    try:
                        valid_from_date = parse_date_string(valid_from_str)
                    except (ValueError, AttributeError):
                        errors.append({
                            "index": index,
                            "assignment_serial": assignment_serial,
                            "error": f"valid_from must be in YYYY-MM-DD or ISO format, got: {valid_from_str}",
                        })
                        continue
                
                valid_to_date: Optional[date] = None
                if valid_to_str:
                    try:
                        valid_to_date = parse_date_string(valid_to_str)
                    except (ValueError, AttributeError):
                        source_field = "expiration_date" if expiration_date_str else "review_date"
                        errors.append({
                            "index": index,
                            "assignment_serial": assignment_serial,
                            "error": f"{source_field} must be in YYYY-MM-DD or ISO format, got: {valid_to_str}",
                        })
                        continue
                
                # Validate date range
                if valid_from_date and valid_to_date and valid_from_date > valid_to_date:
                    source_field = "expiration_date" if expiration_date_str else "review_date"
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": f"valid_from ({valid_from_str}) must be <= {source_field} ({valid_to_str})",
                    })
                    continue
                
                # Attempt insert
                try:
                    result = await conn.execute(
                        insert_query,
                        site,
                        assignment_serial,
                        source_name,
                        center_frequency_hz,
                        bandwidth_hz,
                        freq_start_hz,
                        freq_stop_hz,
                        latitude,
                        longitude,
                        valid_from_date,
                        valid_to_date,
                    )
                    
                    # Parse result string: "INSERT 0 1" means inserted, "INSERT 0 0" means skipped
                    # asyncpg.execute() returns a string like "INSERT 0 1" or "INSERT 0 0"
                    match = re.match(r"INSERT 0 (\d+)", result)
                    if match:
                        rows_affected = int(match.group(1))
                        if rows_affected > 0:
                            inserted_count += 1
                        else:
                            skipped_count += 1
                    else:
                        # Unexpected format, assume inserted if no error
                        inserted_count += 1
                        
                except asyncpg.exceptions.CheckViolationError as e:
                    # Constraint violation (e.g., freq_start_hz > freq_stop_hz)
                    error_msg = str(e).split("\n")[0]  # Get first line of error
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": f"Constraint violation: {error_msg}",
                    })
                    logger.warning(f"Constraint violation for assignment {assignment_serial}: {e}")
                except asyncpg.exceptions.PostgresError as e:
                    # Other database errors
                    error_msg = str(e).split("\n")[0]
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": f"Database error: {error_msg}",
                    })
                    logger.error(f"Database error for assignment {assignment_serial}: {e}", exc_info=True)
                except Exception as e:
                    # Unexpected errors
                    errors.append({
                        "index": index,
                        "assignment_serial": assignment_serial,
                        "error": f"Unexpected error: {str(e)}",
                    })
                    logger.error(f"Unexpected error for assignment {assignment_serial}: {e}", exc_info=True)
    
    except asyncpg.exceptions.PostgresError as e:
        logger.error(f"PostgreSQL error in import_assignments: {e}", exc_info=True)
        raise RuntimeError(f"Database connection failed: {str(e)}") from e
    except Exception as e:
        logger.error(f"Unexpected error in import_assignments: {e}", exc_info=True)
        raise RuntimeError(f"Unexpected database error: {str(e)}") from e
    
    logger.info(
        f"Import complete for site={site}, source_name={source_name}: "
        f"inserted={inserted_count}, skipped={skipped_count}, errors={len(errors)}"
    )
    
    return {
        "inserted": inserted_count,
        "skipped": skipped_count,
        "errors": errors,
    }


