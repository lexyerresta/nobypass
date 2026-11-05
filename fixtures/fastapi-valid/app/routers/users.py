from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import user_service

router = APIRouter(prefix="/users")


@router.get("/")
def list_users(db: Session = Depends(get_db)):
    return user_service.active_emails(db)
