from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


def find_active(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.active.is_(True))))
