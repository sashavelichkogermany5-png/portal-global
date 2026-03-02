import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

APP_NAME = "crew-runner"
API_KEY = os.getenv("CREWAI_API_KEY", "dev")

app = FastAPI(title=APP_NAME, version="0.1.0")


class RunRequest(BaseModel):
    tenantId: str = Field(..., min_length=1)
    correlationId: Optional[str] = None
    type: str = Field(..., min_length=1)
    payload: Dict[str, Any] = Field(default_factory=dict)
    meta: Dict[str, Any] = Field(default_factory=dict)


class DraftAction(BaseModel):
    id: str
    type: str
    title: str
    params: Dict[str, Any] = Field(default_factory=dict)
    safety: Dict[str, Any] = Field(default_factory=dict)


class AgentMessage(BaseModel):
    id: str
    tenantId: str
    correlationId: str
    role: str
    agent: str
    type: str
    content: str
    createdAt: str
    data: Dict[str, Any] = Field(default_factory=dict)


class RunResponse(BaseModel):
    tenantId: str
    correlationId: str
    messages: List[AgentMessage] = Field(default_factory=list)
    drafts: List[DraftAction] = Field(default_factory=list)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mid() -> str:
    return uuid.uuid4().hex


def normalize_event(evt_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "eventType": (evt_type or "").strip().lower(),
        "payload": payload or {},
    }


def route(normalized: Dict[str, Any]) -> str:
    t = normalized["eventType"]
    if t in ("page_view", "pageview"):
        return "UICoach"
    if t in ("lead_created", "lead", "signup"):
        return "Leads"
    if t in ("payment_received", "payment", "invoice_paid"):
        return "Revenue"
    return "UICoach"


def coach_response(normalized: Dict[str, Any]) -> str:
    t = normalized["eventType"]
    if t in ("page_view", "pageview"):
        return "User opened /app. Suggest: show quick tips, highlight next action, and log UI state."
    return f"Received event '{t}'. Suggest: summarize and propose next safe action draft."


@app.post("/run", response_model=RunResponse)
def run(req: RunRequest, x_api_key: str = Header(default="")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    correlation_id = req.correlationId or uuid.uuid4().hex
    tenant_id = req.tenantId

    normalized = normalize_event(req.type, req.payload)
    target = route(normalized)

    messages: List[AgentMessage] = []

    messages.append(
        AgentMessage(
            id=mid(),
            tenantId=tenant_id,
            correlationId=correlation_id,
            role="agent",
            agent="EventNormalizer",
            type="note",
            content=f"Normalized event: {normalized['eventType']}",
            createdAt=now_iso(),
            data={"normalized": normalized},
        )
    )

    messages.append(
        AgentMessage(
            id=mid(),
            tenantId=tenant_id,
            correlationId=correlation_id,
            role="agent",
            agent="Router",
            type="decision",
            content=f"Routed to: {target}",
            createdAt=now_iso(),
            data={"target": target},
        )
    )

    drafts: List[DraftAction] = []

    if target == "UICoach":
        messages.append(
            AgentMessage(
                id=mid(),
                tenantId=tenant_id,
                correlationId=correlation_id,
                role="agent",
                agent="UICoach",
                type="note",
                content=coach_response(normalized),
                createdAt=now_iso(),
                data={"hint": "ui_guidance"},
            )
        )
        drafts.append(
            DraftAction(
                id=mid(),
                type="safe_log",
                title="Write a safe audit note about the UI event",
                params={"message": f"UI event {normalized['eventType']} observed"},
                safety={"risk": "low", "requiresApproval": True},
            )
        )

    elif target == "Revenue":
        messages.append(
            AgentMessage(
                id=mid(),
                tenantId=tenant_id,
                correlationId=correlation_id,
                role="agent",
                agent="Revenue",
                type="note",
                content="Payment event received. Suggest updating subscription state and notifying user (draft only).",
                createdAt=now_iso(),
            )
        )
        drafts.append(
            DraftAction(
                id=mid(),
                type="safe_mark_paid",
                title="Mark invoice as paid (draft)",
                params={"invoiceId": normalized["payload"].get("invoiceId")},
                safety={"risk": "medium", "requiresApproval": True},
            )
        )

    elif target == "Leads":
        messages.append(
            AgentMessage(
                id=mid(),
                tenantId=tenant_id,
                correlationId=correlation_id,
                role="agent",
                agent="Leads",
                type="note",
                content="Lead event received. Suggest enriching lead and creating follow-up task (draft only).",
                createdAt=now_iso(),
            )
        )
        drafts.append(
            DraftAction(
                id=mid(),
                type="safe_create_task",
                title="Create follow-up task (draft)",
                params={"leadId": normalized["payload"].get("leadId")},
                safety={"risk": "low", "requiresApproval": True},
            )
        )

    return RunResponse(
        tenantId=tenant_id,
        correlationId=correlation_id,
        messages=messages,
        drafts=drafts,
    )


@app.get("/health")
def health():
    return {"ok": True, "service": APP_NAME}
