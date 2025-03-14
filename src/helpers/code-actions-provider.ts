import * as vscode from "vscode";
import { LoggingService } from "./logging-service";
import { ModelManager } from "./model-manager";
import { TelemetryReporter } from "./telemetry-reporter";

export class CodeActionsProvider implements vscode.CodeActionProvider {
  constructor(
    private modelManager: ModelManager,
    private logger: LoggingService,
    private telemetry: TelemetryReporter
  ) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    // Don't provide actions if nothing is selected
    if (range.isEmpty) {
      return [];
    }

    const selectedText = document.getText(range);
    if (!selectedText || selectedText.trim() === "") {
      return [];
    }

    // Create code actions
    const actions: vscode.CodeAction[] = [];

    // Add refactor options
    actions.push(
      this.createRefactorAction(
        document,
        range,
        "Improve Code",
        "autogem.improveCode"
      )
    );
    actions.push(
      this.createRefactorAction(
        document,
        range,
        "Add Comments",
        "autogem.addComments"
      )
    );
    actions.push(
      this.createRefactorAction(
        document,
        range,
        "Optimize Performance",
        "autogem.optimizeCode"
      )
    );

    // Add documentation action
    const documentAction = new vscode.CodeAction(
      "Document Code",
      vscode.CodeActionKind.Refactor
    );
    documentAction.command = {
      title: "Document Code",
      command: "autogem.generateDocumentation",
    };
    actions.push(documentAction);

    // Add explain action
    const explainAction = new vscode.CodeAction(
      "Explain Code",
      vscode.CodeActionKind.Refactor
    );
    explainAction.command = {
      title: "Explain Code",
      command: "autogem.explainCode",
    };
    actions.push(explainAction);

    // Add diagnostic-related actions if there are any diagnostics
    if (context.diagnostics.length > 0) {
      actions.push(
        this.createQuickFixAction(
          document,
          range,
          "Fix Issues",
          "autogem.fixIssues"
        )
      );
    }

    return actions;
  }

  private createRefactorAction(
    document: vscode.TextDocument,
    range: vscode.Range,
    title: string,
    command: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
    action.command = {
      title: title,
      command: command,
      arguments: [document, range],
    };
    return action;
  }

  private createQuickFixAction(
    document: vscode.TextDocument,
    range: vscode.Range,
    title: string,
    command: string
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.command = {
      title: title,
      command: command,
      arguments: [document, range],
    };
    return action;
  }
}
