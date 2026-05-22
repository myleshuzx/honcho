"""Hooks for revision d4e5f6a7b8c9 (temporal memory fields)."""

import sqlalchemy as sa

from tests.alembic.registry import register_after_upgrade
from tests.alembic.verifier import MigrationVerifier


@register_after_upgrade("d4e5f6a7b8c9")
def after_upgrade(verifier: MigrationVerifier) -> None:
    """Validate temporal columns and indexes are present."""
    verifier.assert_column_exists("messages", "ingested_at", nullable=False)
    verifier.assert_column_type("messages", "ingested_at", sa.DateTime)
    for column in (
        "generated_at",
        "observed_at",
        "occurred_at",
        "evidence_observed_from",
        "evidence_observed_to",
    ):
        verifier.assert_column_exists("documents", column)
        verifier.assert_column_type("documents", column, sa.DateTime)
    verifier.assert_column_exists("documents", "temporal_kind", nullable=False)
    verifier.assert_column_exists("documents", "temporal_confidence", nullable=False)
    verifier.assert_indexes_exist(
        [
            ("messages", "ix_messages_ingested_at"),
            ("documents", "ix_documents_generated_at"),
            ("documents", "ix_documents_observed_at"),
            ("documents", "ix_documents_occurred_at"),
            ("documents", "ix_documents_evidence_observed_from"),
            ("documents", "ix_documents_evidence_observed_to"),
        ]
    )
