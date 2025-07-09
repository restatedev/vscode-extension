import * as vscode from 'vscode';
import { RestateServerRunner } from './RestateServerRunner';
import { setTimeout } from 'node:timers/promises';

let restateServerRunner: RestateServerRunner | undefined;
let restateServerOutputChannel: vscode.OutputChannel;
let restateServerStatusBarItem: vscode.StatusBarItem;
let restateOpenUIStatusBarItem: vscode.StatusBarItem;
let focusOutputChannelStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	// Build output channel and server runner
	restateServerOutputChannel = vscode.window.createOutputChannel('Restate Server');
	restateServerRunner = new RestateServerRunner(restateServerOutputChannel);

	// Register command to toggle server
	const toggleServerCommand = vscode.commands.registerCommand('restate-vscode.toggleServer', toggleServer);

	// Register command to open UI
	const openUICommand = vscode.commands.registerCommand('restate-vscode.openUI', openRestateUI);

	// Register the command to focus on the output channel
	const focusOutputChannelCommand = vscode.commands.registerCommand('restate-vscode.focusLogs', () => {
		restateServerOutputChannel.show(false);
	});

	// Register command to manually run service registration
	const registerServiceCommand = vscode.commands.registerCommand('restate-vscode.registerService', registerServiceAction);

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

	updateStatusBar(false);
	restateServerStatusBarItem.show();

	// Set up terminal monitoring for auto-start functionality
	setupTerminalMonitoring(context);
	setupDebugConsoleMonitoring(context);

	// Disposable elements when the extension is closed
	context.subscriptions.push(toggleServerCommand, openUICommand, focusOutputChannelCommand, restateServerStatusBarItem, restateOpenUIStatusBarItem, focusOutputChannelStatusBarItem, registerServiceCommand);
}

async function registerServiceAction() {
	const portInput = await vscode.window.showInputBox({
		prompt: 'Enter the service port for registration',
		value: '9080',
		validateInput: (input) => {
			const port = Number(input);
			return isNaN(port) || port <= 0 || port > 65535 ? 'Please enter a valid port number' : null;
		}
	});

	if (!portInput) {
		vscode.window.showWarningMessage('Service registration canceled');
		return;
	}

	const servicePort = Number(portInput);
	await registerRestateServiceDeployment(servicePort);
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
		updateStatusBar(false);
		restateServerOutputChannel.hide();
	} else {
		restateServerOutputChannel.clear();
		restateServerOutputChannel.show(false);
		try {
			await restateServerRunner!!.startServer(getRestateBasePath(), getRestateEnvironmentVariables(), (running) => updateStatusBar(running));
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

function getRestateBasePath(): string {
	return vscode.workspace.workspaceFolders?.at(0)?.uri.path ?? process.cwd();
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

function updateStatusBar(running: boolean) {
	if (running) {
		restateServerStatusBarItem.text = '$(debug-stop) Restate Server';
		restateOpenUIStatusBarItem.show();
		focusOutputChannelStatusBarItem.show();
	} else {
		restateServerStatusBarItem.text = '$(debug-start) Restate Server';
		restateOpenUIStatusBarItem.hide();
		focusOutputChannelStatusBarItem.hide();
	}
}

function setupTerminalMonitoring(context: vscode.ExtensionContext) {
	// Monitor terminal shell executions for "Restate SDK started" message
	const terminalDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
		// Read the terminal output stream in real-time
		const stream = event.execution.read();
		for await (const data of stream) {
			if (await onNewOutputLine(data)) {
				break; // Stop monitoring this execution once we've detected and acted
			}
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

						onNewOutputLine(output).finally(() => { });
					}
				},
			};
		},
	});

	context.subscriptions.push(debugSessionTracker);
}

// Used by TS SDK
const SDK_STARTED_MESSAGE_1 = 'Restate SDK started listening on 9080';
// Used by Golang SDK
const SDK_STARTED_MESSAGE_2 = 'Restate SDK started listening on [::]:9080';
const SDK_STARTED_MESSAGE_3 = 'Restate SDK started listening on 127.0.0.1:9080';
// Old TS SDK message, let's keep it around for some time and then remove it.
const SDK_STARTED_MESSAGE_4 = 'INFO: Listening on 9080...';

let isAutoStarting = false;

async function onNewOutputLine(output: string): Promise<boolean> {
	if (output.includes(SDK_STARTED_MESSAGE_1) || output.includes(SDK_STARTED_MESSAGE_2) || output.includes(SDK_STARTED_MESSAGE_3) || output.includes(SDK_STARTED_MESSAGE_4)) {
		// Auto-start the Restate server if it's not already running
		if (isAutoStarting) {
			return false; // Already auto-starting, no need to do it again
		}
		isAutoStarting = true;
		try {
			await autoStartRestateServer();
			await registerRestateServiceDeployment();
		} finally {
			isAutoStarting = false;
		}
		return true; // Stop monitoring this execution once we've detected and acted
	}
	return false; // Continue monitoring
}

async function autoStartRestateServer() {
	// Only auto-start if the server is not already running
	if (!restateServerRunner?.isRunning()) {
		try {
			// Show notification to user
			vscode.window.showInformationMessage('Restate SDK detected - starting Restate server automatically');

			// Prepare and start the server
			await restateServerRunner!!.startServer(getRestateBasePath(), getRestateEnvironmentVariables(), (running) => updateStatusBar(running));

			// Show success message to the user
			vscode.window.showInformationMessage("Restate server started successfully");
		} catch (error) {
			const errorMessage = `Failed to start Restate server: ${error instanceof Error ? error.message : String(error)}`;
			vscode.window.showErrorMessage(errorMessage);
			throw error;
		}
	}
}

async function registerRestateServiceDeployment(servicePort: number = 9080) {
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

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Registering Restate service deployment at ${servicePort}`,
			cancellable: true
		}, async (progress, cancellationToken) => {
			while (attempt < maxRetries && !cancellationToken.isCancellationRequested) {
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
					progress.report({ message: "registered" });
					return; // Exit the loop on success
				} catch (error) {
					attempt++;
					progress.report({ message: `attempt ${attempt} failed, retrying` });
					console.log(`Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
					await setTimeout(400);
					if (attempt >= maxRetries) {
						throw error;
					}
				}
			}
		});
		vscode.window.showInformationMessage(`Restate service at ${servicePort} registered. Open the UI and start sending some requests!`);
	} catch (error) {
		vscode.window.showErrorMessage(`Error registering Restate service deployment at ${servicePort} after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
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
