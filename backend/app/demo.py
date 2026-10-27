"""Demo shop "AcmeCart" served at /demo — a known target for demos, with 3 planted bugs:

1. Placing an order with discount code SAVE10 returns HTTP 500 (no confirmation page).
2. The mobile menu button (screens < 600px) never opens the menu.   -> demo_site/shop.js
3. Signing in with a wrong password shows no error message.         -> demo_site/login.html
"""
import random
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

SITE_DIR = Path(__file__).resolve().parent.parent / "demo_site"
router = APIRouter(prefix="/demo/api")


class Order(BaseModel):
    email: str
    name: str
    items: list[dict]
    discount: str | None = None


class Login(BaseModel):
    email: str
    password: str


@router.post("/orders")
def place_order(order: Order):
    if order.discount:  # PLANTED BUG 1
        raise HTTPException(500, "Internal Server Error")
    return {"order_id": f"AC-{random.randint(10000, 99999)}"}


@router.post("/login")
def login(body: Login):
    if body.email == "demo@acmecart.test" and body.password == "demo1234":
        return {"ok": True, "name": "Demo User"}
    return {"ok": False}


def mount(app) -> None:
    app.include_router(router)
    app.mount("/demo", StaticFiles(directory=SITE_DIR, html=True), name="demo")
