import * as vscode from 'vscode';
import { RestateServerRunner } from './RestateServerRunner';
import { setTimeout } from 'node:timers/promises';

let restateServerRunner: RestateServerRunner | undefined;
let restateServerOutputChannel: vscode.OutputChannel;
let restateServerStatusBarItem: vscode.StatusBarItem;
let restateOpenUIStatusBarItem: vscode.StatusBarItem;
let focusOutputChannelStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	// Build output channel
	restateServerOutputChannel = vscode.window.createOutputChannel('Restate Server');

	// Register command to toggle server
	const toggleServerCommand = vscode.commands.registerCommand('restate-vscode.toggleServer', toggleServer);

	// Register command to open UI
	const openUICommand = vscode.commands.registerCommand('restate-vscode.openUI', openRestateUI);

	// Register the command to focus on the output channel
	const focusOutputChannelCommand = vscode.commands.registerCommand('restate-vscode.focusLogs', () => {
		restateServerOutputChannel.show(false);
	});

	// Build status bar items
	restateServerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	restateServerStatusBarItem.command = 'restate-vscode.toggleServer';
	restateServerStatusBarItem.tooltip = 'Toggle Restate Server';
	restateOpenUIStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	restateOpenUIStatusBarItem.command = 'restate-vscode.openUI';
	restateOpenUIStatusBarItem.text = '$(restate-icon) UI';
	restateOpenUIStatusBarItem.tooltip = 'Open Restate UI';
	focusOutputChannelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	focusOutputChannelStatusBarItem.command = 'restate-vscode.focusLogs';
	focusOutputChannelStatusBarItem.text = '$(restate-icon) Logs';
	focusOutputChannelStatusBarItem.tooltip = 'Open Restate server logs';

	updateStatusBar();
	restateServerStatusBarItem.show();

	// Set up terminal monitoring for auto-start functionality
	setupTerminalMonitoring(context);
	setupDebugConsoleMonitoring(context);

	// Disposable elements when the extension is closed
	context.subscriptions.push(toggleServerCommand, openUICommand, focusOutputChannelCommand, restateServerStatusBarItem, restateOpenUIStatusBarItem, focusOutputChannelStatusBarItem);
}

async function toggleServer() {
	if (restateServerRunner?.isRunning()) {
		try {
			await restateServerRunner.stopServer();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to stop Restate server: ${error instanceof Error ? error.message : String(error)}`);
			restateServerOutputChannel.appendLine(`Failed to stop server: ${error instanceof Error ? error.message : String(error)}`);
		}
		restateServerRunner = undefined;
		updateStatusBar();
		restateServerOutputChannel.hide();
	} else {

		restateServerOutputChannel.clear();
		restateServerOutputChannel.show(false);
		const restateBasePath = vscode.workspace.workspaceFolders?.at(0)?.uri.path ?? process.cwd();
		restateServerRunner = new RestateServerRunner(restateServerOutputChannel, restateBasePath, getRestateEnvironmentVariables());
		try {
			await restateServerRunner.startServer(() => updateStatusBar());
			updateStatusBar();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to start Restate server: ${error instanceof Error ? error.message : String(error)}`);
			restateServerOutputChannel.appendLine(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

async function openRestateUI() {
	const url = vscode.Uri.parse('http://localhost:9070/ui');
	try {
		// Open in VS Code's Simple Browser with split right positioning
		await vscode.commands.executeCommand('simpleBrowser.api.open', url, {
			preserveFocus: false,
			viewColumn: vscode.ViewColumn.Beside // Opens split to the right
		});
	} catch (error) {
		// Fallback to external browser if Simple Browser fails
		vscode.window.showErrorMessage(`Failed to open Restate UI in Simple Browser, trying external browser: ${error instanceof Error ? error.message : String(error)}`);
		try {
			await vscode.env.openExternal(url);
		} catch (fallbackError) {
			vscode.window.showErrorMessage(`Failed to open Restate UI: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
		}
	}
}

function getRestateEnvironmentVariables(): Record<string, string> {
	const config = vscode.workspace.getConfiguration('restate');
	const customEnvVars = config.get<Record<string, string>>('serverEnv', {
		"RESTATE_ADMIN__experimental_feature_force_journal_retention": "365days",
		"RESTATE_WORKER__INVOKER__INACTIVITY_TIMEOUT": "1day"
	});

	// Log custom environment variables for debugging
	if (Object.keys(customEnvVars).length > 0) {
		restateServerOutputChannel.appendLine(`Going to use environment variables: ${JSON.stringify(customEnvVars)}`);
	}

	return customEnvVars;
}

function updateStatusBar() {
	if (restateServerRunner?.isRunning()) {
		restateServerStatusBarItem.text = '$(debug-stop) Restate Server';
		restateOpenUIStatusBarItem.show();
		focusOutputChannelStatusBarItem.show();
	} else {
		restateServerStatusBarItem.text = '$(debug-start) Restate Server';
		restateOpenUIStatusBarItem.hide();
		focusOutputChannelStatusBarItem.hide();
	}
}

// Used by TS SDK
const SDK_STARTED_MESSAGE_1 = 'Restate SDK started listening on 9080';
// Used by Golang SDK
const SDK_STARTED_MESSAGE_2 = 'Restate SDK started listening on [::]:9080';
const SDK_STARTED_MESSAGE_3 = 'Restate SDK started listening on 127.0.0.1:9080';
// Old TS SDK message, let's keep it around for some time and then remove it.
const SDK_STARTED_MESSAGE_4 = 'INFO: Listening on 9080...';

function setupTerminalMonitoring(context: vscode.ExtensionContext) {
	// Monitor terminal shell executions for "Restate SDK started" message
	const terminalDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
		try {
			restateServerOutputChannel.appendLine(`Monitoring terminal command: ${event.execution.commandLine.value}`);

			// Read the terminal output stream in real-time
			const stream = event.execution.read();
			for await (const data of stream) {
				// Check if the output contains "Restate SDK started"
				if (data.includes(SDK_STARTED_MESSAGE_1) || data.includes(SDK_STARTED_MESSAGE_2) || data.includes(SDK_STARTED_MESSAGE_3) || data.includes(SDK_STARTED_MESSAGE_4)) {
					restateServerOutputChannel.appendLine(`Detected Restate service in terminal - will start Restate server...`);

					// Auto-start the Restate server if it's not already running
					await autoStartRestateServer();
					await registerRestateServiceDeployment();
					break; // Stop monitoring this execution once we've detected and acted
				}
			}
		} catch (error) {
			// Ignore errors from terminal monitoring to avoid disrupting other functionality
			console.log(`Terminal monitoring error: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	context.subscriptions.push(terminalDisposable);
}

function setupDebugConsoleMonitoring(context: vscode.ExtensionContext) {
	const debugSessionTracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
		createDebugAdapterTracker(session) {
			return {
				onDidSendMessage(message) {
					if (message.type === 'event' && message.event === 'output' && (message.body?.category === 'console' || message.body?.category === 'stderr' || message.body?.category === 'stdout')) {
						const output = message.body?.output || "";

						// Check for specific messages in the debug console output
						if (output.includes(SDK_STARTED_MESSAGE_1) || output.includes(SDK_STARTED_MESSAGE_2) || output.includes(SDK_STARTED_MESSAGE_3) || output.includes(SDK_STARTED_MESSAGE_4)) {
							restateServerOutputChannel.appendLine(`Detected Restate service in debug session - will start Restate server...`);

							// Auto-start the Restate server if it's not already running
							autoStartRestateServer()
								.catch(error => {
									console.error(`Error auto-starting Restate server: ${error instanceof Error ? error.message : String(error)}`);
								})
								.then(() => registerRestateServiceDeployment().catch(error => {
									console.error(`Error registering Restate service deployment: ${error instanceof Error ? error.message : String(error)}`);
								}));
						}
					}
				},
			};
		},
	});

	context.subscriptions.push(debugSessionTracker);
}

async function autoStartRestateServer() {
	// Only auto-start if the server is not already running
	if (!restateServerRunner?.isRunning()) {
		try {
			// Show notification to user
			vscode.window.showInformationMessage('Restate SDK detected - starting Restate server automatically');

			// Prepare and start the server
			const restateBasePath = vscode.workspace.workspaceFolders?.at(0)?.uri.path ?? process.cwd();
			restateServerRunner = new RestateServerRunner(restateServerOutputChannel, restateBasePath, getRestateEnvironmentVariables());
			await restateServerRunner.startServer(() => updateStatusBar());

			// Update UI
			updateStatusBar();

			// Show success message to the user
			vscode.window.showInformationMessage("Restate server started successfully");
		} catch (error) {
			const errorMessage = `Failed to start Restate server: ${error instanceof Error ? error.message : String(error)}`;
			vscode.window.showErrorMessage(errorMessage);
			throw error;
		}
	}
}

let isRegisteringDeployment = false;

async function registerRestateServiceDeployment() {
	if (isRegisteringDeployment) {
		return; // Prevent concurrent registrations
	}
	isRegisteringDeployment = true;
	await _registerRestateServiceDeployment().finally(() => {
		isRegisteringDeployment = false;
	});
}

async function _registerRestateServiceDeployment(servicePort: number = 9070) {
	const url = 'http://localhost:9070/deployments';
	const payload = {
		uri: `http://localhost:${servicePort}`,
		additional_headers: {},
		use_http_11: false,
		force: true,
		dry_run: false
	};

	const maxRetries = 10;
	let attempt = 0;

	while (attempt < maxRetries) {
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) {
				throw new Error(`Failed to register deployment: ${response.statusText}`);
			}

			const responseBody = await response.json();
			console.log(responseBody);
			vscode.window.showInformationMessage(`Restate service deployment at ${servicePort} registered successfully`);
			return; // Exit the loop on success
		} catch (error) {
			attempt++;
			console.log(`Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
			await setTimeout(400);
			if (attempt >= maxRetries) {
				vscode.window.showErrorMessage(`Error registering Restate service deployment at ${servicePort} after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
}

// This method is called when your extension is deactivated
export async function deactivate() {
	restateServerOutputChannel.appendLine('Extension deactivating, stopping server...');
	if (restateServerRunner) {
		try {
			await restateServerRunner!!.stopServer();
		} catch (error) {
			console.error(`Error stopping Restate server: ${error instanceof Error ? error.message : String(error)}`);
		}
		restateServerRunner = undefined;
	}
}
