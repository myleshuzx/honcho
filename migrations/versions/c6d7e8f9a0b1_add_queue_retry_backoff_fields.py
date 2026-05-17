"""add queue retry backoff fields

Revision ID: c6d7e8f9a0b1
Revises: e4eba9cfaa6f
Create Date: 2026-05-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from migrations.utils import get_schema

# revision identifiers, used by Alembic.
revision: str = "c6d7e8f9a0b1"
down_revision: str | None = "e4eba9cfaa6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

schema = get_schema()


def upgrade() -> None:
    op.add_column("queue", sa.Column("last_error", sa.TEXT(), nullable=True), schema=schema)
    op.add_column(
        "queue",
        sa.Column(
            "retry_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        schema=schema,
    )
    op.add_column(
        "queue",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        schema=schema,
    )
    op.create_index(
        "ix_queue_next_attempt_at",
        "queue",
        ["next_attempt_at"],
        unique=False,
        schema=schema,
    )
    op.create_index(
        "ix_queue_pending_next_attempt",
        "queue",
        ["processed", "next_attempt_at", "id"],
        unique=False,
        schema=schema,
        postgresql_where=sa.text("processed = false"),
    )


def downgrade() -> None:
    op.drop_index("ix_queue_pending_next_attempt", table_name="queue", schema=schema)
    op.drop_index("ix_queue_next_attempt_at", table_name="queue", schema=schema)
    op.drop_column("queue", "next_attempt_at", schema=schema)
    op.drop_column("queue", "retry_count", schema=schema)
    op.drop_column("queue", "last_error", schema=schema)
