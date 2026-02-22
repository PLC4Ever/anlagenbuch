from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Plant
from app.db.session import get_db
from app.deps import require_roles


router = APIRouter(tags=["plants"])


class PlantIn(BaseModel):
    slug: str
    display_name: str
    area_prefix: str = "MS"
    active: bool = True


class PlantPatch(BaseModel):
    display_name: str | None = None
    area_prefix: str | None = None
    active: bool | None = None


@router.get("/plants/{plant_slug}")
def get_plant(plant_slug: str, db: Session = Depends(get_db)):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_slug))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")
    return {
        "plant_id": plant.id,
        "plant_slug": plant.slug,
        "display_name": plant.display_name,
        "area_prefix": plant.area_prefix,
        "upload_rules": {"max_file_size_mb": 50},
    }


@router.get("/plants")
def list_plants(
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    plants = db.scalars(select(Plant).order_by(Plant.slug.asc())).all()
    return [
        {
            "id": p.id,
            "slug": p.slug,
            "display_name": p.display_name,
            "area_prefix": p.area_prefix,
            "active": p.active,
        }
        for p in plants
    ]


@router.post("/plants", status_code=201)
def create_plant(
    payload: PlantIn,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    exists = db.scalar(select(Plant).where(Plant.slug == payload.slug))
    if exists:
        raise HTTPException(status_code=409, detail="slug exists")
    plant = Plant(**payload.model_dump())
    db.add(plant)
    db.commit()
    db.refresh(plant)
    return {"id": plant.id, **payload.model_dump()}


@router.patch("/plants/{plant_slug}")
def patch_plant(
    plant_slug: str,
    payload: PlantPatch,
    _: object = Depends(require_roles("Admin")),
    db: Session = Depends(get_db),
):
    plant = db.scalar(select(Plant).where(Plant.slug == plant_slug))
    if not plant:
        raise HTTPException(status_code=404, detail="plant not found")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(plant, key, value)
    db.commit()
    db.refresh(plant)
    return {
        "id": plant.id,
        "slug": plant.slug,
        "display_name": plant.display_name,
        "area_prefix": plant.area_prefix,
        "active": plant.active,
    }
