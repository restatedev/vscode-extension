import * as vscode from 'vscode';
import { RestateServerRunner } from './RestateServerRunner';
import {setTimeout} from 'node:timers/promises';

let restateServerRunner: RestateServerRunner | undefined;
let restateServerOutputChannel: vscode.OutputChannel;
let restateServerStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	// Build output channel
	restateServerOutputChannel = vscode.window.createOutputChannel('Restate Server');

	// Register command to toggle server
	const toggleServerCommand = vscode.commands.registerCommand('restate-vscode.toggleServer', toggleServer);

    // Register command to open UI
    const openUICommand = vscode.commands.registerCommand('restate-vscode.openUI', openRestateUI);

	// Build status bar
	restateServerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	restateServerStatusBarItem.command = 'restate-vscode.toggleServer';
	updateStatusBar();
	restateServerStatusBarItem.show();

	// Set up terminal monitoring for auto-start functionality
	setupTerminalMonitoring(context);

	// Disposable elements when the extension is closed
	context.subscriptions.push(toggleServerCommand, openUICommand, restateServerStatusBarItem);
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
		restateServerOutputChannel.show();
		const restateBasePath = vscode.workspace.workspaceFolders?.at(0)?.uri.path ?? process.cwd();
		restateServerRunner = new RestateServerRunner(restateServerOutputChannel, restateBasePath, getRestateEnvironmentVariables());
		try {
			await restateServerRunner.startServer();
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
 		if (!vscode.env.openExternal(url)) {
        vscode.window.showErrorMessage(`Failed to open Restate UI`);
		}
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to open Restate UI: ${error instanceof Error ? error.message : String(error)}`);
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
	} else {
		restateServerStatusBarItem.text = '$(debug-start) Restate Server';
	}
}

const SDK_TS_STARTED_MESSAGE = 'INFO: Listening on 9080...';

function setupTerminalMonitoring(context: vscode.ExtensionContext) {
	// Monitor terminal shell executions for "Restate SDK started" message
	const terminalDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
		try {
			restateServerOutputChannel.appendLine(`Monitoring terminal command: ${event.execution.commandLine.value}`);
			
			// Read the terminal output stream in real-time
			const stream = event.execution.read();
			for await (const data of stream) {
				// Check if the output contains "Restate SDK started"
				if (data.includes(SDK_TS_STARTED_MESSAGE)) {
					restateServerOutputChannel.appendLine(`Detected "${SDK_TS_STARTED_MESSAGE}" - attempting to auto-start Restate server...`);

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

async function autoStartRestateServer() {
	// Only auto-start if the server is not already running
	if (!restateServerRunner?.isRunning()) {
		try {
			// Show notification to user
			vscode.window.showInformationMessage('Restate SDK detected - starting Restate server automatically');
			
			// Prepare and start the server
			const restateBasePath = vscode.workspace.workspaceFolders?.at(0)?.uri.path ?? process.cwd();
			restateServerRunner = new RestateServerRunner(restateServerOutputChannel, restateBasePath, getRestateEnvironmentVariables());
			await restateServerRunner.startServer();

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

async function registerRestateServiceDeployment() {
    const url = 'http://localhost:9070/deployments';
    const payload = {
        uri: 'http://localhost:9080',
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
            vscode.window.showInformationMessage('Restate service deployment registered successfully');
            return; // Exit the loop on success
        } catch (error) {
            attempt++;
            console.error(`Attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)}`);
			await setTimeout(200);
            if (attempt >= maxRetries) {
                vscode.window.showErrorMessage(`Error registering Restate service deployment after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
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

	// Additional cleanup
	if (restateServerStatusBarItem) {
		restateServerStatusBarItem.dispose();
	}
	if (restateServerOutputChannel) {
		restateServerOutputChannel.dispose();
	}
}
