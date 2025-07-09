# Configuring Nodemon for Development in Node.js Projects

## Summary

To enable efficient development with automatic restarts on file changes, Node.js projects should be configured with **Nodemon**. This guide outlines how to properly set up `nodemon`, define its configuration, create an appropriate entry point, and ensure compatibility with `chs-dev`.

Note: The resolution steps covers both `Typescript` and `Javascript` setup. Change the file extension accordingly.
E.g `filename.js` or `filename.ts`

## Resolution Summary

Follow these steps to set up Nodemon in the service local repository:
Example location: `./docker-chs-development/repositories/overseas-entities-web`

### 1. Install Nodemon

Install `nodemon` in the service local repository as a development dependency:

```bash
npm install --save-dev nodemon@3.0.1

```

### 2. Define the Nodemon Entry Point

Create the `nodemon-entry.ts` in express server parent directory.
E.g: `src/bin/nodemon-entry.ts` or `server/bin/nodemon-entry.ts`

Import the appropriate express server from its location file.
Example configuration:

```ts
import app from "../app";

const PORT = 3000;

app.set("port", PORT);

app.listen(PORT, () => {
  console.log(`✅  Application Ready. Running on port ${PORT}`);
});

```

```js
const app = require("./../app");

const PORT = 3000;

app.set("port", PORT);

app.listen(PORT, () => {
  console.log(`:white_tick:  Application Ready. Running on port ${PORT}`);
});

```

It is important the listen event is configured exactly as described above:
This output is used to verify the application is up and running.
Sample `nodemon.entry` file: `/local/builders/node/v3/bin/config/nodemon-entry`.


### 3. Create nodemon.json configuration
In the root of your project, add a `nodemon.json` file with the following configuration:

For Typescript setup:
```json
{
  "exec": "ts-node ./src/bin/nodemon-entry.ts",
  "ext": "ts,html",
  "watch": ["./src", "./views"],
  "events": {
    "restart": "echo '🔄 '  Nodemon Restarting...",
    "crash": "echo '💥 '  Nodemon Crashed!"
  }
}

```
Configure the event properties exactly as above. If the express server parent
directory is not `src`, change the base directory accordingly in the `exec`
and `watch` properties. Ensure the `exec` property contains relative path to `nodemon-entry.ts` file.
Other properties can be ammended as appropriate.
Sample `nodemon.json` where express server parent directory is `server`:

```json
{
  "exec": "ts-node ./server/bin/nodemon-entry.ts",
  "ext": "ts,html",
  "watch": ["./server", "./views"],
  "events": {
    "restart": "echo '🔄 '  Nodemon Restarting...",
    "crash": "echo '💥 '  Nodemon Crashed!"
  }
}

```

For Javascript setup:
```json
{
 "exec": "node ./server/bin/nodemon-entry.js",
  "ext": "ts,html",
  "watch": ["./server", "./views"],
  "events": {
    "restart": "echo '🔄 '  Nodemon Restarting...",
    "crash": "echo '💥 '  Nodemon Crashed!"
  }
}

```
This configuration does the following:

Runs the app through nodemon via `ts-node` at `./server/bin/nodemon-entry.ts` or via `node` at `./server/bin/nodemon-entry.js`

Watches the `server` and `views` directory for changes.

#### To Add a VScode debugger support
1. Configure the `exec` property in the nodemon.json file as follows:

Typescript:
```json
{
  "exec": "node --inspect=0.0.0.0:9229 -r ts-node/register src/bin/nodemon-entry.ts",
}
```
Javascript:
```json
{
  "exec": "node --inspect=0.0.0.0:9229 src/bin/nodemon-entry.js"
}
```
2. Create a vscode configuration file in the codebase root dir: `.vscode/launch.json`

```json
  {
    "version": "0.2.0",
    "configurations": [
      {
        "type": "node",
        "request": "attach",
        "name": "attach - remote",
        "address": "localhost",
        "port": 9229,
        "restart": false,
        "sourceMaps": true,
        "remoteRoot": "/app",
        "localRoot": "${workspaceFolder}",
        "resolveSourceMapLocations": [
          "${workspaceFolder}/**",
          "!**/node_modules/**"
        ]
      }
    ]
}

```
More information on usage: https://code.visualstudio.com/docs/debugtest/debugging


### 4. Update the package.json Scripts

In your project's `package.json`, add the following to the scripts section.

```json
"scripts": {
  ...other scripts
  "chs-dev": "nodemon --legacy-watch"
}
```

### 5. Start your Development Environment

To start your local environment, run:

```bash
chs-dev up

```
Begin local development once you see this message:

Example Message:`Service: overseas-entities-web ready!`



## Rationale
Using Nodemon in development allows you to:

Work more efficiently without manually restarting your app

Monitor multiple file types for changes

Receive meaningful feedback when your app starts, restarts, or crashes

Maintain a standardized development experience across environments

By following this setup, your development workflow will be faster,
more stable.

