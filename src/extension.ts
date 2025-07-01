import * as vscode from 'vscode';
import { RestateServerRunner } from './RestateServerRunner';

let restateServerRunner: RestateServerRunner | undefined;
let restateServerOutputChannel: vscode.OutputChannel;
let restateServerStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	// Build output channel
	restateServerOutputChannel = vscode.window.createOutputChannel('Restate Server');

	// Register command to toggle server
	const toggleServerCommand = vscode.commands.registerCommand('restate-vscode.toggleServer', toggleServer);

	// Build status bar
	restateServerStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	restateServerStatusBarItem.command = 'restate-vscode.toggleServer';
	updateStatusBar();
	restateServerStatusBarItem.show();

	// Disposable elements when the extension is closed
	context.subscriptions.push(toggleServerCommand, restateServerStatusBarItem);
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

function getRestateEnvironmentVariables(): Record<string, string> {
	const config = vscode.workspace.getConfiguration('restate');
	const customEnvVars = config.get<Record<string, string>>('serverEnv', {
		"RESTATE_ADMIN__experimental_feature_force_journal_retention": "365days",
		"RESTATE_WORKER__INVOKER__INACTIVITY_TIMEOUT": "1day"
	});

	// Log custom environment variables for debugging
	if (Object.keys(customEnvVars).length > 0) {
		restateServerOutputChannel.appendLine(`Going to use environment variables: ${Object.keys(customEnvVars).join(', ')}`);
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
