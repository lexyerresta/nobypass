from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/users")


@router.get("/")
def list_users(db: Session = Depends(get_db)):
    # "Quick fix" from an AI agent: query straight from the router.
    return [user.email for user in db.query(User).filter(User.active.is_(True)).all()]
