// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn } from 'child_process';

let serverProcess: ReturnType<typeof spawn> | undefined;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let workspaceFolder: vscode.WorkspaceFolder | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Only activate if we have a workspace folder
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		// Don't show warning for global activation, just return silently
		return;
	}

	workspaceFolder = vscode.workspace.workspaceFolders[0];
	
	outputChannel = vscode.window.createOutputChannel('Restate Server');

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'restate-vscode.toggleServer';
	updateStatusBar();
	statusBarItem.show();

	const toggleServerCommand = vscode.commands.registerCommand('restate-vscode.toggleServer', async () => {
		if (serverProcess) {
			stopServer();
		} else {
			await startServer();
		}
	});

	// Listen for workspace folder changes
	const workspaceFolderChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		// If the current workspace folder is removed, stop the server
		if (event.removed.some(folder => folder === workspaceFolder)) {
			stopServer();
			workspaceFolder = undefined;
		}
	});

	
	context.subscriptions.push(toggleServerCommand, statusBarItem, workspaceFolderChangeDisposable);
}

function getCustomEnvironmentVariables(): Record<string, string> {
	const config = vscode.workspace.getConfiguration('restate');
	const customEnvVars = config.get<Record<string, string>>('customEnvironmentVariables', {});
	
	// Log custom environment variables for debugging
	if (Object.keys(customEnvVars).length > 0) {
		outputChannel.appendLine(`Using custom environment variables: ${Object.keys(customEnvVars).join(', ')}`);
	}
	
	return customEnvVars;
}

async function startServer() {
	if (serverProcess) {
		vscode.window.showWarningMessage('Restate server is already running');
		return;
	}

	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder available');
		return;
	}

	outputChannel.clear();
	outputChannel.show();

	const restateBasePath = workspaceFolder.uri.path;

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Starting Restate server...",
		cancellable: false
	}, async () => {
		try {
			// Check if the Restate server binary is already available
			const serverPath = `${restateBasePath}/.restate/bin/restate-server`;
			const fs = require('fs');
			
			if (!fs.existsSync(serverPath)) {
				// Install the Restate server locally if not available
				outputChannel.appendLine('Installing Restate server...');
				const installProcess = spawn('npm', ['install','--global', '--no-save', '--prefix', '.restate', '@restatedev/restate-server@latest'], {
					env: { ...process.env },
					cwd: restateBasePath,
					detached: false,
				});
				installProcess.stdout?.on('data', (data) => outputChannel.append(data.toString()));
				installProcess.stderr?.on('data', (data) => outputChannel.append(data.toString()));

				// Wait for installation to complete
				await new Promise<void>((resolve, reject) => {		
					installProcess.on('close', (code) => {
						if (code === 0) {
							outputChannel.appendLine('Restate server installed successfully');
							resolve();
						} else {
							reject(new Error(`Installation failed with code ${code}`));
						}
					});
					
					installProcess.on('error', (error) => {
						reject(new Error(`Installation error: ${error.message}`));
					});
				});
			} else {
				outputChannel.appendLine(`Using installed binary at ${serverPath}`);
			}

			// Get custom environment variables from settings
			const customEnvVars = getCustomEnvironmentVariables();
			
			// Now run the server directly from node_modules
			serverProcess = spawn(serverPath, ["--node-name", "vscode-dev", "--base-dir", ".restate"], {
				env: { "RESTATE_DISABLE_ANSI_CODES": "true", ...process.env, ...customEnvVars },
				cwd: restateBasePath,
				detached: false,
			});

			serverProcess.stdout?.on('data', (data) => outputChannel.append(data.toString()));
			serverProcess.stderr?.on('data', (data) => outputChannel.append(data.toString()));
			
			serverProcess.on('close', (code) => {
				outputChannel.appendLine(`Server process exited with code ${code}`);
				serverProcess = undefined;
				updateStatusBar();
			});
			
			serverProcess.on('error', (error) => {
				outputChannel.appendLine(`Server process error: ${error.message}`);
				serverProcess = undefined;
				updateStatusBar();
			});

			updateStatusBar();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to start Restate server: ${error instanceof Error ? error.message : String(error)}`);
			outputChannel.appendLine(`Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

function stopServer() {
	if (serverProcess) {
		const processToKill = serverProcess;
		serverProcess = undefined; // Clear reference immediately
		
		// Try graceful shutdown first
		processToKill.kill('SIGTERM');
		
		// Force kill after 3 seconds if still running
		const forceKillTimeout = setTimeout(() => {
			try {
				processToKill.kill('SIGKILL');
				outputChannel.appendLine('Restate server force stopped');
			} catch (error) {
				outputChannel.appendLine(`Error force killing server: ${error}`);
			}
			updateStatusBar();
		}, 10_000);
		
		// Handle process close
		processToKill.once('close', () => {
			clearTimeout(forceKillTimeout);
			outputChannel.appendLine('Restate server stopped');
			updateStatusBar();
		});
		
		// Handle process error
		processToKill.once('error', (error) => {
			clearTimeout(forceKillTimeout);
			outputChannel.appendLine(`Server process error: ${error.message}`);
			updateStatusBar();
		});
		
		vscode.window.showInformationMessage('Restate server stopped');
	}
	outputChannel.hide();
}

function updateStatusBar() {
	if (serverProcess) {
		statusBarItem.text = '$(debug-stop) Restate Server';
	} else {
		statusBarItem.text = '$(debug-start) Restate Server';
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	outputChannel.appendLine('Extension deactivating, stopping server...');
	stopServer();
	
	// Additional cleanup
	if (statusBarItem) {
		statusBarItem.dispose();
	}
	if (outputChannel) {
		outputChannel.dispose();
	}
}
