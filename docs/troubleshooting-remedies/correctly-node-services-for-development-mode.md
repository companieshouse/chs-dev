# Configuring Nodemon for Development in Node.js Projects

## Problem Summary

To enable efficient development with automatic restarts on file changes, Node.js projects should be configured with **Nodemon**. This guide outlines how to properly set up `nodemon`, define its configuration, create an appropriate entry point, and ensure compatibility with `chs-dev`.

## Resolution Summary

Follow these steps to set up Nodemon in the service local repository:
Example location: `./docker-chs-development/repositories/overseas-entities-web`

### 1. Install Nodemon

Install `nodemon` in the service local repository as a development dependency:

```bash
npm install --save-dev nodemon@3.0.1

```

### 2. Define the Nodemon Entry Point

Create a file at this location `src/bin/nodemon-entry.ts`, import the appropriate
express server from its location file. Example configuration:

```ts
import app from "../app";

const PORT = 3000;

app.set("port", PORT);

app.listen(PORT, () => {
  console.log(`✅  Application Ready. Running on port ${PORT}`);
});

```
It is important the listen event is configured exactly as described above:
This output is used to verify the application is up and running.
Example File Location: `local/builders/node/v3/bin/config/nodemon-entry`

### 3. Create nodemon.json configuration
In the root of your project, add a `nodemon.json` file with the following configuration:

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
Configure the event properties exactly as above. If the root directory is not `src`,
change the base directory accordingly in the `exec` and `watch` properties.
Ensure the `exec` property contains `/bin/nodemon-entry.ts`. Other properties can be
ammended as appropriate. Example:

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
This configuration does the following:

Runs the app through nodemon via ts-node at `./server/bin/nodemon-entry.ts`

Watches the `server` and `views` directory for changes.


### 4. Update the package.json Scripts

In your project's package.json, add the following to the scripts section:

```json
"scripts": {
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

