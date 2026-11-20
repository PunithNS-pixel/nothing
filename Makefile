.PHONY: up down seed test logs
up:
	docker compose up -d --build
	docker compose run --rm migrate
seed:
	docker compose run --rm api python -m scripts.seed
logs:
	docker compose logs -f api outbox consumer notifications
down:
	docker compose down
test:
	python -m pytest -q
