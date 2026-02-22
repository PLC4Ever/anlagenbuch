.PHONY: debian-prepare debian-build-ui debian-smoke debian-seed debian-install legacy-up legacy-down legacy-seed legacy-smoke legacy-test

debian-prepare:
	bash ops/debian/scripts/prepare_native.sh

debian-build-ui:
	bash ops/debian/scripts/build_ui.sh

debian-smoke:
	bash ops/debian/scripts/smoke_native.sh

debian-seed:
	.venv/bin/python tools/seed.py

debian-install:
	sudo bash ops/debian/scripts/install_native.sh

legacy-up:
	python tools/sb_agent.py up

legacy-down:
	python tools/sb_agent.py down

legacy-seed:
	python tools/sb_agent.py seed

legacy-smoke:
	python tools/sb_agent.py smoke

legacy-test:
	python tools/sb_agent.py test
