# =============================================================================
# Interview Bot - Makefile
# =============================================================================
# Usage:
#   make start    - Start bot and open VNC (recommended)
#   make stop     - Stop the bot
#   make restart  - Restart and open VNC
#   make logs     - View logs
#   make build    - Rebuild container
# =============================================================================

.PHONY: start stop restart logs build clean

# Default target - start and open VNC
start:
	@./start.sh

# Start without VNC
start-headless:
	@./start.sh --no-vnc

# Stop the bot
stop:
	@docker-compose down

# Restart and open VNC
restart:
	@docker-compose down
	@./start.sh

# View logs
logs:
	@docker-compose logs -f

# Rebuild container
build:
	@docker-compose build

# Full rebuild (no cache)
rebuild:
	@docker-compose build --no-cache

# Clean up
clean:
	@docker-compose down -v --remove-orphans
	@docker system prune -f

