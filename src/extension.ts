// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { CustomBuildTaskProvider } from './task';

let rustProblemTaskProvider: vscode.Disposable | undefined;

export function activate(_context: vscode.ExtensionContext) {
	const rootPath =
		vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
			? vscode.workspace.workspaceFolders[0].uri.fsPath
			: "";

	rustProblemTaskProvider = vscode.tasks.registerTaskProvider(CustomBuildTaskProvider.rustProblemTaskType, new CustomBuildTaskProvider(rootPath));
}

// this method is called when your extension is deactivated
export function deactivate() {
	if (rustProblemTaskProvider) {
		rustProblemTaskProvider.dispose();
	}
}
