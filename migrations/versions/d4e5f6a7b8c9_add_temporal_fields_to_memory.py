"""add temporal fields to memory

Revision ID: d4e5f6a7b8c9
Revises: c6d7e8f9a0b1
Create Date: 2026-05-21

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.utils import get_schema

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

schema = get_schema()


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "ingested_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema=schema,
    )
    op.create_index(
        "ix_messages_ingested_at",
        "messages",
        ["ingested_at"],
        unique=False,
        schema=schema,
    )

    op.add_column(
        "documents",
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema=schema,
    )
    for column_name in (
        "observed_at",
        "occurred_at",
        "evidence_observed_from",
        "evidence_observed_to",
    ):
        op.add_column(
            "documents",
            sa.Column(column_name, sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )
        op.create_index(
            f"ix_documents_{column_name}",
            "documents",
            [column_name],
            unique=False,
            schema=schema,
        )
    op.add_column(
        "documents",
        sa.Column(
            "temporal_kind",
            sa.TEXT(),
            server_default="unknown",
            nullable=False,
        ),
        schema=schema,
    )
    op.add_column(
        "documents",
        sa.Column(
            "temporal_confidence",
            sa.TEXT(),
            server_default="none",
            nullable=False,
        ),
        schema=schema,
    )
    op.create_index(
        "ix_documents_generated_at",
        "documents",
        ["generated_at"],
        unique=False,
        schema=schema,
    )


def downgrade() -> None:
    op.drop_index("ix_documents_generated_at", table_name="documents", schema=schema)
    op.drop_column("documents", "temporal_confidence", schema=schema)
    op.drop_column("documents", "temporal_kind", schema=schema)
    for column_name in (
        "evidence_observed_to",
        "evidence_observed_from",
        "occurred_at",
        "observed_at",
    ):
        op.drop_index(
            f"ix_documents_{column_name}", table_name="documents", schema=schema
        )
        op.drop_column("documents", column_name, schema=schema)
    op.drop_column("documents", "generated_at", schema=schema)
    op.drop_index("ix_messages_ingested_at", table_name="messages", schema=schema)
    op.drop_column("messages", "ingested_at", schema=schema)
