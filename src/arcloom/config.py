from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ARCLOOM_", env_file=".env", extra="ignore", case_sensitive=False
    )

    data_dir: Path = Path("data")
    graph_mode: Literal["server", "lite"] = "server"
    graph_host: str = "127.0.0.1"
    graph_port: int = Field(6379, ge=1, le=65535)
    graph_password: SecretStr = SecretStr("")
    graph_ssl: bool = False
    graph_prefix: str = "arcloom_v1"
    admin_token: SecretStr = SecretStr("")
    tenant: str = "lab-01"
    cookie_secure: bool = False
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    allowed_origins: list[str] = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    assessment_seconds: int = Field(48 * 3600, ge=60, le=7 * 86400)
    session_seconds: int = Field(8 * 3600, ge=60, le=86400)
    approval_seconds: int = Field(15 * 60, ge=30, le=3600)
    execution_budget: int = Field(20, ge=1, le=100)
    model_call_budget: int = Field(20, ge=1, le=200)
    max_depth: int = Field(3, ge=1, le=5)
    worker_enabled: bool = True
    worker_poll_seconds: float = Field(0.5, ge=0.1, le=10)
    run_lease_seconds: int = Field(45, ge=30, le=300)
    lab_url: str = "http://127.0.0.1:9001"
    runner_secret: SecretStr = SecretStr("")
    lab_timeout_seconds: float = Field(8.0, ge=0.1, le=15)
    provider: Literal["deterministic", "openai", "anthropic"] = "deterministic"
    model: str = ""
    model_api_key: SecretStr = SecretStr("")
    model_timeout_seconds: float = Field(20.0, ge=1, le=30)
    web_dist: Path = Path("apps/web/dist")

    @field_validator("graph_prefix", "tenant")
    @classmethod
    def safe_identifier(cls, value: str) -> str:
        if (
            not value
            or len(value) > 48
            or not all(c.isascii() and (c.isalnum() or c in "_-") for c in value)
        ):
            raise ValueError("Use 1–48 ASCII letters, digits, underscores or hyphens")
        return value

    @field_validator("lab_url")
    @classmethod
    def lab_is_local(cls, value: str) -> str:
        parsed = urlsplit(value)
        # This application is a controlled lab, not a URL scanning service.
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"lab", "127.0.0.1", "localhost"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError("lab_url must be a fixed localhost or Compose lab HTTP origin")
        return value.rstrip("/")

    @model_validator(mode="after")
    def valid_provider(self) -> "Settings":
        if self.provider != "deterministic" and (
            not self.model or not self.model_api_key.get_secret_value()
        ):
            raise ValueError("A model ID and API key are required for the selected model provider")
        return self
