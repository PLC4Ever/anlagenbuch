from __future__ import annotations

from fastapi import FastAPI, Request

app = FastAPI(title="Webhook Stub")


@app.post("/webhook")
async def webhook(request: Request):
    payload = await request.json()
    if payload.get("force_fail"):
        return {"ok": False, "status": 500}
    return {"ok": True}
