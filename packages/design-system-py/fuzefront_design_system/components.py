"""
Component schema and UI data structures adhering to FuzeFront DS.
"""

from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class StatusPillData:
    status: str  # online, executing, pending, offline, error
    label: str
    pulse: bool = False

    def to_dict(self) -> Dict[str, Any]:
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
    thought: Optional[str] = None
    tool_call: Optional[Dict[str, str]] = None
    status: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
            "thought": self.thought,
            "toolCall": self.tool_call,
            "status": self.status,
        }
