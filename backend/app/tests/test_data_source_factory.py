"""Tests for DataSource factory function."""

from __future__ import annotations

import os

import pytest

from app.services.data_source import DataSource, get_data_source
from app.services.legacy_data_source import LegacyGoldDataSource
from app.services.rfproc_data_source import RfprocGoldSilverDataSource


def test_factory_defaults_to_legacy(monkeypatch):
    """Test that factory defaults to legacy mode when DATA_SOURCE_MODE is not set."""
    # Remove DATA_SOURCE_MODE if set
    monkeypatch.delenv("DATA_SOURCE_MODE", raising=False)
    data_source = get_data_source()
    assert isinstance(data_source, LegacyGoldDataSource)


def test_factory_legacy_mode(monkeypatch):
    """Test that factory returns LegacyGoldDataSource when DATA_SOURCE_MODE=legacy."""
    monkeypatch.setenv("DATA_SOURCE_MODE", "legacy")
    data_source = get_data_source()
    assert isinstance(data_source, LegacyGoldDataSource)


def test_factory_rfproc_mode(monkeypatch):
    """Test that factory returns RfprocGoldSilverDataSource when DATA_SOURCE_MODE=rfproc."""
    monkeypatch.setenv("DATA_SOURCE_MODE", "rfproc")
    data_source = get_data_source()
    assert isinstance(data_source, RfprocGoldSilverDataSource)


def test_factory_implements_interface():
    """Test that factory returns an object implementing DataSource interface."""
    data_source = get_data_source()
    assert isinstance(data_source, DataSource)
    # Check that required methods exist
    assert hasattr(data_source, "list_surveys")
    assert hasattr(data_source, "list_bands")
    assert hasattr(data_source, "get_holds")

