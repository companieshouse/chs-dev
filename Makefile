.PHONY = clean
clean:
	rm -rf lib tmp dist

lib:
	mkdir lib

lib/version: lib package.json
	node -e 'const readFileSync = require("fs").readFileSync; console.log(JSON.parse(readFileSync("./package.json").toString("utf8")).version)' > lib/version

.PHONY = build
build: lib/version
	npm run build

.PHONY = lint
lint:
	npm run lint

.PHONY = lint-fix
lint-fix:
	npm run lint:fix

package: clean build
	npm run pack
