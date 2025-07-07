import { spawn } from 'child_process';
import * as vscode from 'vscode';

export class RestateServerRunner {
	private serverProcess: ReturnType<typeof spawn> | undefined;
	private outputChannel: vscode.OutputChannel;
	private restateBasePath: string;
	private customEnvVars: Record<string, string>;
	private starting: boolean;

	constructor(
		outputChannel: vscode.OutputChannel,
		restateBasePath: string,
		customEnvVars: Record<string, string>
	) {
		this.outputChannel = outputChannel;
		this.restateBasePath = restateBasePath;
		this.customEnvVars = customEnvVars;
		this.starting = false;
	}

	async startServer(onProcessClosed: () => void): Promise<void> {
		if (this.starting) {
			vscode.window.showWarningMessage('Restate server is already starting');
			return;
		}
		this.starting = true;
		if (this.serverProcess) {
			vscode.window.showWarningMessage('Restate server is already running');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Starting Restate server...",
			cancellable: true
		}, async (progress, cancellationToken) => {
			// Check if the Restate server binary is already available
			const serverPath = `${this.restateBasePath}/.restate/bin/restate-server`;
			const baseDirServerPath = `${this.restateBasePath}/.restate`;
			const fs = require('fs');

			if (!fs.existsSync(serverPath)) {
				// Install the Restate server locally if not available
				await this.installRestateServer(cancellationToken);
			} else {
				this.outputChannel.appendLine(`Using installed binary at ${serverPath}`);
			}

			if (cancellationToken.isCancellationRequested) {
				return;
			}

			// Now run the server
			this.serverProcess = spawn(serverPath, ["--node-name", "dev-cluster", "--base-dir", baseDirServerPath], {
				env: { "RESTATE_LOG_DISABLE_ANSI_CODES": "true", ...process.env, ...this.customEnvVars },
				cwd: this.restateBasePath,
			});
			this.serverProcess.stdout?.on('data', (data) => this.outputChannel.append(data.toString()));
			this.serverProcess.stderr?.on('data', (data) => this.outputChannel.append(data.toString()));
			this.serverProcess.on('close', (code) => {
				this.outputChannel.appendLine(`Server process exited with code ${code}`);
				this.serverProcess = undefined;
				onProcessClosed();
			});
			this.serverProcess.on('error', (error) => {
				this.outputChannel.appendLine(`Server process error: ${error.message}`);
				this.serverProcess = undefined;
				onProcessClosed();
			});

			// Start completed, flip the starting flag
			this.starting = false;
		});
	}

	async stopServer(): Promise<void> {
		if (this.starting) {
			vscode.window.showWarningMessage('Restate server is starting now, ignoring');
			return;
		}
		if (this.serverProcess) {
			const processToKill = this.serverProcess;
			this.serverProcess = undefined; // Clear reference immediately

			// Try graceful shutdown first
			processToKill.kill('SIGTERM');

			return new Promise<void>((resolve, reject) => {

				// Force kill after 10 seconds if still running
				const forceKillTimeout = setTimeout(() => {
					try {
						processToKill.kill('SIGKILL');
						this.outputChannel.appendLine('Restate server force stopped');
					} catch (error) {
						this.outputChannel.appendLine(`Error force killing server: ${error}`);
						reject(new Error(`Error when killing the Restate server: ${error instanceof Error ? error.message : String(error)}`));
					}
				}, 10_000);

				// Handle process close
				processToKill.once('close', () => {
					clearTimeout(forceKillTimeout);
					this.outputChannel.appendLine('Restate server stopped');
					resolve();
				});

				// Handle process error
				processToKill.once('error', (error) => {
					clearTimeout(forceKillTimeout);
					this.outputChannel.appendLine(`Server process error: ${error.message}`);
					reject(new Error(`Error when closing the Restate server: ${error instanceof Error ? error.message : String(error)}`));
				});
			});
		} else {
			return Promise.resolve();
		}
	}

	private async installRestateServer(cancellationToken: vscode.CancellationToken): Promise<void> {
		this.outputChannel.appendLine(`Installing Restate server in ${this.restateBasePath}/.restate ...`);
		const installProcess = spawn('npm', ['install', '--global', '--no-save', '--prefix', '.restate', '@restatedev/restate-server@latest'], {
			env: process.env,
			cwd: this.restateBasePath,
			detached: false,
		});
		cancellationToken.onCancellationRequested(() => {
			installProcess.kill();
		});
		installProcess.stdout?.on('data', (data) => this.outputChannel.append(data.toString()));
		installProcess.stderr?.on('data', (data) => this.outputChannel.append(data.toString()));

		// Wait for installation to complete
		await new Promise<void>((resolve, reject) => {
			installProcess.on('close', (code) => {
				if (code === 0) {
					this.outputChannel.appendLine('Restate server installed successfully');
					resolve();
				} else {
					reject(new Error(`Installation failed with code ${code}`));
				}
			});

			installProcess.on('error', (error) => {
				reject(new Error(`Installation error: ${error.message}`));
			});
		});
	}

	isRunning(): boolean {
		return this.serverProcess !== undefined;
	}
} 