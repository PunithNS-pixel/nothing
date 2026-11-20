from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    database_url: str = 'postgresql+psycopg://store:store@localhost:5432/store'
    jwt_secret: str = 'CHANGE_ME_USE_A_LONG_RANDOM_SECRET_32_CHARACTERS'
    jwt_issuer: str = 'retail-platform'
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    cors_origins: str = 'http://localhost:3000,http://localhost:5173'
    kafka_bootstrap_servers: str = 'localhost:9092'
    kafka_security_protocol: str = 'PLAINTEXT'
    kafka_sasl_mechanism: str = 'SCRAM-SHA-256'
    kafka_username: str = ''
    kafka_password: str = ''
    kafka_ca_file: str = ''
    kafka_cert_file: str = ''
    kafka_key_file: str = ''
    kafka_topic: str = 'store.events'
    opensearch_url: str = 'http://localhost:9200'
    opensearch_username: str = ''
    opensearch_password: str = ''
    opensearch_ca_file: str = ''
    opensearch_index: str = 'store-products-v1'
    rabbitmq_url: str = 'amqp://guest:guest@localhost:5672/'
    admin_email: str = 'admin@example.com'
    admin_password: str = ''
    environment: str = 'development'

@lru_cache
def get_settings() -> Settings:
    return Settings()
