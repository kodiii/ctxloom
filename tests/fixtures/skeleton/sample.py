"""Sample Python fixture for Skeletonizer coverage tests."""
import json
from typing import Optional


class UserService:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    def get_user(self, user_id: str) -> Optional[dict]:
        with open(self.db_path, "r") as f:
            data = json.load(f)
        # BODY_SENTINEL_DO_NOT_LEAK
        return data.get(user_id)


def format_user(user: dict) -> str:
    # BODY_SENTINEL_DO_NOT_LEAK
    return f"{user['name']} <{user['email']}>"
