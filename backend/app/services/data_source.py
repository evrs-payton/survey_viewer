"""Data source abstraction for gold holds data.

Provides a unified interface for reading gold holds data from both legacy
and rfproc sources, with adapters that normalize data to a common format.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Dict, List, Optional


class DataSource(ABC):
    """Abstract base class for data sources that provide gold holds data."""

    @abstractmethod
    def list_surveys(self, filters: Dict) -> List[Dict]:
        """List available surveys/sites with optional filters.

        Args:
            filters: Optional filter dictionary (implementation-specific)

        Returns:
            List of survey dictionaries with 'survey_id' field in format:
            - Legacy: 'legacy:{site}:{yyyy-mm}'
            - rfproc: 'rfproc:{mission_type}:{site}:{sensor}:{run_id}'
        """
        pass

    @abstractmethod
    def list_bands(self, survey_id: str) -> List[Dict]:
        """List bands for a survey.

        Args:
            survey_id: Opaque survey identifier (adapter parses format)

        Returns:
            List of band dictionaries with band identifiers and metadata
        """
        pass

    @abstractmethod
    def get_holds(
        self,
        survey_id: str,
        band_id: str,
        product_type: str = "holds",
        max_points: Optional[int] = None,
    ) -> Dict:
        """Get normalized holds data for frontend.

        Args:
            survey_id: Opaque survey identifier (adapter parses format)
            band_id: Band identifier (format depends on mode)
            product_type: Product type (default: "holds")
            max_points: Optional maximum number of points (downsample if n_freqs > max_points)

        Returns:
            Dictionary with normalized holds data:
            {
                "freqs": List[float],
                "max_hold": List[float],
                "min_hold": List[float],
                "avg_hold": List[float],
                "metadata": Dict,
                "source_mode": str
            }
        """
        pass


def get_data_source() -> DataSource:
    """Factory function to get the appropriate data source based on environment.

    Returns:
        DataSource instance (LegacyGoldDataSource or RfprocGoldSilverDataSource)

    Environment Variables:
        DATA_SOURCE_MODE: "legacy" (default) or "rfproc"
    """
    mode = os.getenv("DATA_SOURCE_MODE", "legacy")
    if mode == "rfproc":
        from .rfproc_data_source import RfprocGoldSilverDataSource

        return RfprocGoldSilverDataSource()
    from .legacy_data_source import LegacyGoldDataSource

    return LegacyGoldDataSource()

