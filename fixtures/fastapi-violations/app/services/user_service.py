from sqlalchemy.orm import Session

from app.repositories import user_repository


def active_emails(db: Session) -> list[str]:
    try:
        return [user.email for user in user_repository.find_active(db)]
    except Exception:
        return []
