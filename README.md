# Restate VS Code Extension

Welcome to the Restate VS Code Extension! This tool is your gateway to seamless integration with Restate, the platform for building innately resilient applications. Whether you're managing local servers or exploring Restate's UI, this extension has got you covered.

**NOTE** This plugin is currently **experimental** and some of its features might not work correctly and/or might change. This is currently developed as a personal project of mine. 

## 🚀 Get me started

* Use `npx -y @restatedev/create-app@latest && cd restate-node-template && npm install` to bootstrap the Restate template
* `code .` to start VSCode
* Install the extension from https://marketplace.visualstudio.com/items?itemName=slinkydeveloper.restate-vscode-unofficial
* Now press `F5` (`Run > Start Debugging`). The example will start, and together with it the restate-server will be downloaded and started.
* Explore the available features by typing `Restate` in the commands bar.

## ✨ Features

- **Auto install Restate Server**: Installs automatically Restate server in your project directory. For more info about the server license, checkout https://www.npmjs.com/package/@restatedev/restate-server
- **Start/Stop Restate Server**: Easily toggle a local Restate server instance directly from VS Code status bar.
- **Auto register service**: Detects when Restate SDK starts and automatically starts the restate-server with it, and registers the deployment. Only works with Typescript and Golang SDK at the moment.
- ***Snippets**: Some handy restate snippets.

## 📜 Release Notes

### 0.0.6

- **New Configuration: `restate.autoRegistrationMode`**: Allows users to control the behavior of service registration. Modes include:
  - `Disabled`: Disables automatic service registration.
  - `Ask confirmation`: Prompts the user for confirmation before registering a service.
  - `Automatic`: Automatically registers the service without user intervention (default).
- **New Configuration: `restate.autoStartRestateServer`**: Allows users to control the behavior of auto starting the restate-server when a Restate service is detected. Modes include:
  - `Disabled`: Disables automatic starting of restate server.
  - `Ask confirmation`: Prompts the user for confirmation before starting the restate server.
  - `Automatic`: Automatically starts the restate server (default).

### 0.0.5

- Initial release with server management and UI integration.
