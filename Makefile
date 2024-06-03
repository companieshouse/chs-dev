..PHONY = install
install:
	@npm install

.PHONY = clean
clean:
	rm -rf lib tmp dist

.PHONY = build
build: install
	@npm run build

.PHONY = lint
lint: install
	@npm run lint

.PHONY = lint-fix
lint-fix: install
	@npm run lint:fix

version: package.json lib/index.js
	node -e 'const readFileSync = require("fs").readFileSync; console.log(JSON.parse(readFileSync("./package.json").toString("utf8")).version)' | grep -Eo '^[[:digit:]]+\.[[:digit:]]+' | tee ./version

package: clean build version
	@npm run pack

.PHONY = test-unit
test-unit: install test
	@echo "unit tests run"

.PHONY = test
test: install
	@npm run test

.PHONY: security-check
security-check:
	@npm audit --audit-level=high


.PHONY: sonar
sonar:
	@echo "Sonarqube not configured"
