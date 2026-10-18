"""
Component schema and UI data structures adhering to FuzeFront DS.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class StatusPillData:
    status: str  # online, executing, pending, offline, error
    label: str
    pulse: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "label": self.label,
            "pulse": self.pulse,
        }


@dataclass
class ChatBubbleData:
    id: str
    role: str  # user | agent | system
    content: str
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    thought: str | None = None
    tool_call: dict[str, str] | None = None
    status: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "thought": self.thought,
            "toolCall": self.tool_call,
            "status": self.status,
        }
