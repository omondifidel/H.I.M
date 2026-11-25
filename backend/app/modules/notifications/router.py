from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.deps import current_user, require_admin
from app.modules.auth.models import User
from app.modules.notifications.models import Notification, NotificationRead

router = APIRouter(tags=["notifications"])


class NotificationCreate(BaseModel):
    kind: str = Field(default="announcement", pattern="^(announcement|new_book|system|reminder)$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=2000)
    link: str = Field(default="", max_length=300)
    user_id: Optional[str] = None


@router.get("/api/notifications")
def list_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification)
        .where(or_(Notification.user_id.is_(None), Notification.user_id == user.id))
        .order_by(Notification.created_at.desc())
        .limit(40)
    ).all()
    read_ids = set(db.scalars(select(NotificationRead.notification_id).where(NotificationRead.user_id == user.id)).all())
    items = [
        {
            "id": n.id,
            "kind": n.kind,
            "title": n.title,
            "body": n.body,
            "link": n.link,
            "created_at": n.created_at.isoformat(),
            "read": n.id in read_ids,
        }
        for n in rows
    ]
    return {"items": items, "unread": sum(1 for i in items if not i["read"])}


@router.post("/api/notifications/{notif_id}/read", status_code=204)
def mark_read(notif_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    exists = db.scalar(select(NotificationRead).where(NotificationRead.notification_id == notif_id, NotificationRead.user_id == user.id))
    if not exists and db.get(Notification, notif_id):
        db.add(NotificationRead(notification_id=notif_id, user_id=user.id))
        db.commit()


@router.post("/api/notifications/read-all", status_code=204)
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification.id).where(or_(Notification.user_id.is_(None), Notification.user_id == user.id))).all()
    read_ids = set(db.scalars(select(NotificationRead.notification_id).where(NotificationRead.user_id == user.id)).all())
    for nid in rows:
        if nid not in read_ids:
            db.add(NotificationRead(notification_id=nid, user_id=user.id))
    db.commit()


@router.get("/api/admin/notifications", dependencies=[Depends(require_admin)])
def admin_list_notifications(db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(50)).all()
    return [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "user_id": n.user_id, "created_at": n.created_at.isoformat()}
        for n in rows
    ]


@router.post("/api/admin/notifications", dependencies=[Depends(require_admin)])
def admin_send_notification(data: NotificationCreate, db: Session = Depends(get_db)):
    n = Notification(kind=data.kind, title=data.title.strip(), body=data.body.strip(), link=data.link.strip(), user_id=data.user_id or None)
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "user_id": n.user_id, "created_at": n.created_at.isoformat()}


@router.delete("/api/admin/notifications/{notif_id}", status_code=204, dependencies=[Depends(require_admin)])
def admin_delete_notification(notif_id: str, db: Session = Depends(get_db)):
    n = db.get(Notification, notif_id)
    if n:
        db.delete(n)
        db.commit()
