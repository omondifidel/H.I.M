from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.deps import current_user
from app.modules.auth.models import User
from app.modules.search import service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = Query(min_length=1, max_length=500), kind: str = Query("all", pattern="^(all|sermon|book|note)$"),
           speaker: str = Query("", max_length=120),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.search(db, user, q, kind, speaker=speaker)


@router.get("/speakers")
def speakers(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[str]:
    return service.speakers(db)
