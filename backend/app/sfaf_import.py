#!/usr/bin/env python3
"""CLI script for importing SFAF 1-column files into the assignments database.

This script parses SFAF files and imports the assignments into PostgreSQL.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

# Add parent directory to path for imports when run as script
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.assignment_import import import_assignments
from app.services.sfaf_parser import parse_sfaf_file


def _detect_file_type(filename: str, content: str) -> str:
    """Detect file type (JSON or SFAF) from filename and content."""
    # Check file extension first
    filename_lower = filename.lower()
    if filename_lower.endswith('.json'):
        return "json"
    if filename_lower.endswith('.sfaf'):
        return "sfaf"
    if filename_lower.endswith('.txt'):
        # For .txt files, try JSON first (faster check)
        try:
            parsed = json.loads(content)
            if isinstance(parsed, list):
                return "json"
        except (json.JSONDecodeError, ValueError):
            pass
        # If JSON parse fails, assume SFAF
        return "sfaf"
    
    # No extension or unknown extension - try JSON first
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list):
            return "json"
    except (json.JSONDecodeError, ValueError):
        pass
    
    # Check for SFAF markers (lines starting with 005 and 924)
    lines = content.split('\n')
    has_005 = any(line.startswith('005') for line in lines[:100])  # Check first 100 lines
    has_924 = any(line.startswith('924') for line in lines)
    
    if has_005 and has_924:
        return "sfaf"
    
    # Default to JSON if we can't determine
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list):
            return "json"
    except (json.JSONDecodeError, ValueError):
        pass
    
    raise ValueError("Could not determine file type. Expected JSON array or SFAF 1-column format.")




def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Process SFAF 1-column or JSON file and import into assignments database'
    )
    parser.add_argument('input_file', help='Path to the SFAF 1-column or JSON file to process')
    parser.add_argument(
        '--json-output', '-j',
        help='Optional JSON output filename (for debugging, only used with SFAF input)'
    )
    
    args = parser.parse_args()
    
    # Check if input file exists
    if not Path(args.input_file).exists():
        print(f"Error: File '{args.input_file}' not found.", file=sys.stderr)
        sys.exit(1)
    
    # Read file content to detect type
    try:
        with open(args.input_file, 'r') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Detect file type
    try:
        file_type = _detect_file_type(args.input_file, content)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Parse file based on type
    print(f"Detected file type: {file_type.upper()}")
    print(f"Parsing file: {args.input_file}")
    try:
        if file_type == "json":
            processed_records = json.loads(content)
            if not isinstance(processed_records, list):
                print("Error: JSON file must contain an array of assignment objects", file=sys.stderr)
                sys.exit(1)
            # Validate JSON structure (each item should be a dict)
            for i, item in enumerate(processed_records):
                if not isinstance(item, dict):
                    print(f"Error: JSON array item at index {i} must be an object", file=sys.stderr)
                    sys.exit(1)
        elif file_type == "sfaf":
            processed_records = parse_sfaf_file(args.input_file)
        else:
            print(f"Error: Unsupported file type: {file_type}", file=sys.stderr)
            sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON file: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error parsing file: {e}", file=sys.stderr)
        sys.exit(1)
    
    print(f"Parsed {len(processed_records)} records")
    
    if len(processed_records) == 0:
        print("Warning: No valid records found in SFAF file.", file=sys.stderr)
        sys.exit(1)
    
    # Prompt for site name
    site = input("Enter site name (required): ").strip()
    if not site:
        print("Error: Site name is required", file=sys.stderr)
        sys.exit(1)
    
    # Optionally save JSON output (only for SFAF files)
    if args.json_output and file_type == "sfaf":
        json_file = json.dumps(processed_records, indent=4)
        with open(args.json_output, mode="w") as f:
            f.write(json_file)
        print(f"JSON output saved to: {args.json_output}")
    
    # Run import
    source_name = "SFAF" if file_type == "sfaf" else "JSON"
    print(f"\nImporting {len(processed_records)} assignments for site '{site}' (source: {source_name})...")
    try:
        result = asyncio.run(import_assignments(
            site=site,
            source_name=source_name,
            assignments=processed_records,
        ))
    except Exception as e:
        print(f"Error during import: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Display results
    print(f"\nImport complete:")
    print(f"  Inserted: {result['inserted']}")
    print(f"  Skipped: {result['skipped']}")
    
    if result['errors']:
        print(f"  Errors: {len(result['errors'])}")
        for error in result['errors'][:10]:  # Show first 10 errors
            print(f"    [{error['index']}] {error['assignment_serial']}: {error['error']}")
        if len(result['errors']) > 10:
            print(f"    ... and {len(result['errors']) - 10} more errors")
    
    # Exit with error code if there were errors
    if result['errors']:
        sys.exit(1)


if __name__ == "__main__":
    main()

