from functools import lru_cache

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    node_env: str = "development"
    engrove_version: str = "0.1.0"
    internal_service_secret: SecretStr
    log_level: str = "info"

    @model_validator(mode="after")
    def reject_development_secret_in_production(self) -> "Settings":
        value = self.internal_service_secret.get_secret_value().lower()
        if self.node_env == "production" and ("dev_only" in value or value == "change-me"):
            raise ValueError("development placeholder secret is forbidden in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
