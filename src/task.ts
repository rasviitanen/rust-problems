import * as vscode from 'vscode';
import * as cp from 'child_process';
import { Diagnostic, Span } from './rust';

interface CustomBuildTaskDefinition extends vscode.TaskDefinition {
    command: string;
}

type Command = {
    name: string,
    command: string,
};

export class CustomBuildTaskProvider implements vscode.TaskProvider {
    static rustProblemTaskType = 'rust-problem';
    private tasks: vscode.Task[] | undefined;
    private rustDiagnosticsCollection = vscode.languages.createDiagnosticCollection("rustProblems");

    constructor(private workspaceRoot: string) { }

    public async provideTasks(): Promise<vscode.Task[]> {
        return this.getTasks();
    }

    public resolveTask(_task: vscode.Task): vscode.Task | undefined {
        const flavor: string = _task.definition.flavor;
        if (flavor) {
            const definition: CustomBuildTaskDefinition = <any>_task.definition;
            return this.getTask({ name: _task.name, command: definition.command }, definition);
        }
        return undefined;
    }

    private getTasks(): vscode.Task[] {
        if (this.tasks !== undefined) {
            return this.tasks;
        }

        this.tasks = [];
        const commands: Command[] = [
            { name: "cargo check", command: "check --quiet --message-format json" },
            { name: "cargo check --all-targets", command: "check --all-targets --quiet --message-format json" },
            { name: "cargo build", command: "build --quiet --message-format json" },
            { name: "cargo build --release", command: "build --release --quiet --message-format json" },
            { name: "cargo clippy", command: "clippy --quiet --message-format json" },
            { name: "cargo clippy --all-targets", command: "clippy --all-targets --quiet --message-format json" },
        ];

        commands.forEach(command => {
            this.tasks!.push(this.getTask(command));
        });
        return this.tasks;
    }

    private getTask(command: Command, definition?: CustomBuildTaskDefinition): vscode.Task {
        if (definition === undefined) {
            definition = {
                type: CustomBuildTaskProvider.rustProblemTaskType,
                command: command.command,
            };
            definition.presentation = {
                reveal: "never",
            };
        }

        const task = new vscode.Task(definition, vscode.TaskScope.Workspace, command.name,
            CustomBuildTaskProvider.rustProblemTaskType, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
                // When the task is executed, this callback will run. Here, we setup for running the task.
                return new CustomBuildTaskTerminal(this.workspaceRoot, this.rustDiagnosticsCollection, `cargo ${command.command}`);
            }));

        if (!task.presentationOptions.reveal) {
            task.presentationOptions.reveal = vscode.TaskRevealKind.Silent;
        }

        return task;
    }
}


const formatText = (text: string) => {
    return `${text.replace(/[\n\r]/g, '\r\n')}`;
};

const spanToRange = (span: Span): vscode.Range => {
    return new vscode.Range(span.line_start - 1, span.column_start - 1, span.line_end - 1, span.column_end - 1);
};

class CustomBuildTaskTerminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    private closeEmitter = new vscode.EventEmitter<number>();
    onDidClose?: vscode.Event<number> = this.closeEmitter.event;
    private rustFixProvider = new RustFixProvider();

    constructor(private workspaceRoot: string, private rustProblemDiagnostics: vscode.DiagnosticCollection, private command: string) {
        vscode.languages.registerCodeActionsProvider('rust', this.rustFixProvider, {
            providedCodeActionKinds: RustFixProvider.providedCodeActionKinds
        });
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.rustProblemDiagnostics.clear();
        this.execTask();
    }

    close(): void {
        this.rustProblemDiagnostics.dispose();
    }

    private exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            cp.exec(command, options, (error, stdout, stderr) => {
                this.rustProblemDiagnostics.clear();
                const fixes: vscode.CodeAction[] = [];

                let diagnostics = stdout.split('\n');
                let reportDiagnostics: Map<string, vscode.Diagnostic[]> = new Map();

                diagnostics.forEach(diagnostic => {
                    try {
                        const parsed = JSON.parse(diagnostic) as Diagnostic;
                        if (parsed.message && parsed.message.spans.length > 0) {
                            const leafSpan = parsed.message.spans[parsed.message.spans.length - 1];
                            const range = spanToRange(leafSpan);
                            const severity = () => {
                                if (parsed.message.level === "error") {
                                    return vscode.DiagnosticSeverity.Error;
                                } else if (parsed.message.level === "info") {
                                    return vscode.DiagnosticSeverity.Information;
                                } else if (parsed.message.level === "warning") {
                                    return vscode.DiagnosticSeverity.Warning;
                                } else if (parsed.message.level === "help") {
                                    return vscode.DiagnosticSeverity.Hint;
                                } else if (parsed.message.level === "note") {
                                    return vscode.DiagnosticSeverity.Information;
                                }
                            };
                            const diagnostic = new vscode.Diagnostic(range, parsed.message.message, severity());
                            if (parsed.message.code) {
                                diagnostic.code = parsed.message.code.code;
                            }
                            diagnostic.relatedInformation = [];

                            const children = parsed.message.children;
                            children.forEach(child => {
                                if (child.spans.length > 0) {
                                    const childLeafSpan = child.spans[child.spans.length - 1];
                                    const childLocation = new vscode.Location(vscode.Uri.parse(`${this.workspaceRoot}/${childLeafSpan.file_name}`), spanToRange(childLeafSpan));

                                    let textEdits: Map<vscode.Uri, vscode.TextEdit[]> = new Map();
                                    child.spans.filter(span => span.suggested_replacement).forEach(span => {
                                        const replaceRange = spanToRange(span);
                                        const replaceDocumentUri = vscode.Uri.parse(`${this.workspaceRoot}/${span.file_name}`);
                                        const prevFixes = textEdits.get(replaceDocumentUri) || [];
                                        prevFixes.push(new vscode.TextEdit(replaceRange, span.suggested_replacement!));
                                        textEdits.set(replaceDocumentUri, prevFixes);
                                    });
                                    if (textEdits.size > 0) {
                                        const fix = new vscode.CodeAction(`FIX: ${child.message}`, vscode.CodeActionKind.QuickFix);
                                        fix.diagnostics = [diagnostic];
                                        fix.edit = new vscode.WorkspaceEdit();
                                        textEdits.forEach((edits, uri) => {
                                            fix.edit!.set(uri, edits);
                                        });
                                        fixes.push(fix);
                                    }

                                    diagnostic.relatedInformation!.push(new vscode.DiagnosticRelatedInformation(childLocation, `${child.level.toUpperCase()}: ${child.message}`));
                                } else {
                                    diagnostic.relatedInformation!.push(new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.parse(`${this.workspaceRoot}/${leafSpan.file_name}`), range), `${child.level.toUpperCase()}: ${child.message}`));
                                }
                            });

                            parsed.message.spans.forEach(span => {
                                if (span.label) {
                                    const location = new vscode.Location(vscode.Uri.parse(`${this.workspaceRoot}/${span.file_name}`), spanToRange(span));
                                    diagnostic.relatedInformation!.push(new vscode.DiagnosticRelatedInformation(location, `SPAN: ${span.label}`));
                                }
                            });


                            const prevDiagnostics = reportDiagnostics.get(leafSpan.file_name);
                            reportDiagnostics.set(leafSpan.file_name, prevDiagnostics ? [...prevDiagnostics, diagnostic] : [diagnostic]);
                        }
                    } catch { }
                });


                this.rustFixProvider.fixes = fixes;
                this.writeEmitter.fire(formatText(stdout));
                this.writeEmitter.fire(formatText(stderr));
                reportDiagnostics.forEach((diagnostics, file) => {
                    this.rustProblemDiagnostics.set(vscode.Uri.parse(`${this.workspaceRoot}/${file}`), diagnostics);
                });

                this.closeEmitter.fire(0);

                if (error) {
                    reject({ error, stdout, stderr });
                }
                resolve({ stdout, stderr });
            });
        });
    }

    private async execTask(): Promise<void> {
        this.writeEmitter.fire(`Executing ${this.command} in ${this.workspaceRoot}...\r\n`);
        this.exec(this.command, { cwd: this.workspaceRoot }).then(() => {
            this.writeEmitter.fire(`\r\n\r\n${this.command} completed.\r\n\r\n`);
        }).catch(() => {
            this.writeEmitter.fire(`\r\n\r\n${this.command} failed.\r\n\r\n`);
        });
    }
}


export class RustFixProvider implements vscode.CodeActionProvider {
    public fixes: vscode.CodeAction[] = [];

    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(_document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.CodeAction[] {
        return this.fixes.filter(fix => {
            return context.diagnostics.includes(fix.diagnostics![0]!);
        }).map(fix => {
            return fix;
        });
    }
}