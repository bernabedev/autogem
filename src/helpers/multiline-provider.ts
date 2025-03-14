import * as vscode from "vscode";
import { LanguageFeatures } from "./language-features";
import { LoggingService } from "./logging-service";
import { ModelManager } from "./model-manager";
import { TelemetryReporter } from "./telemetry-reporter";

export class MultilineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  constructor(
    private modelManager: ModelManager,
    private logger: LoggingService,
    private telemetry: TelemetryReporter
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<
    vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null
  > {
    const config = vscode.workspace.getConfiguration("autogem");

    // Only trigger multiline completions on explicit user request or after certain triggers
    if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke) {
      const line = document.lineAt(position.line).text;
      const triggerMultiline = config.get<string[]>("multilineTriggers", [
        "{",
        ":",
        "=>",
        "->",
        "do",
        "then",
      ]);

      // Check if line ends with a multiline trigger
      const endsWithTrigger = triggerMultiline.some((trigger) =>
        line.trimRight().endsWith(trigger)
      );

      if (!endsWithTrigger) {
        return null;
      }
    }

    try {
      // Get the context for completion
      const contextData = await this.getContextData(document, position, config);

      // Check if we're in a valid context for multiline completion
      if (
        !this.shouldTriggerMultilineCompletion(contextData, document, position)
      ) {
        return null;
      }

      this.logger.debug(
        `Requesting multiline completion for ${document.languageId} at line ${
          position.line + 1
        }`
      );

      // Get suggestions from model manager
      const suggestions = await this.modelManager.getMultilineCompletions(
        contextData.contextText,
        document.languageId,
        position,
        token
      );

      if (token.isCancellationRequested || !suggestions.length) {
        return null;
      }

      // Transform suggestions into VS Code inline completion items
      const items = suggestions.map((suggestion) => {
        // Ensure proper indentation for all lines
        const indentedSuggestion = this.applyIndentation(
          suggestion,
          contextData.indentation
        );

        return {
          insertText: new vscode.SnippetString(indentedSuggestion),
          range: new vscode.Range(position, position),
        };
      });

      // Track successful multiline completion generation
      this.telemetry.trackEvent("multiline_completion_generated", {
        language: document.languageId,
      });

      return items.map((item) => ({
        ...item,
        command: {
          title: "Track accepted multiline completion",
          command: "autogem.trackAcceptedMultilineCompletion",
          arguments: [{ language: document.languageId }],
        },
      }));
    } catch (error) {
      this.logger.error("Error in multiline completion provider", error);
      return null;
    }
  }

  private async getContextData(
    document: vscode.TextDocument,
    position: vscode.Position,
    config: vscode.WorkspaceConfiguration
  ) {
    // Get more context for multiline completions
    const contextLineCount = config.get<number>(
      "multilineContextLineCount",
      100
    );

    // Get the indentation of the current line
    const currentLine = document.lineAt(position.line);
    const indentation = currentLine.text.match(/^\s*/)?.[0] || "";

    // Get the context before the cursor
    const startLine = Math.max(0, position.line - contextLineCount);
    const contextRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      position
    );
    const contextText = document.getText(contextRange);

    // Get language-specific features
    const languageFeatures = new LanguageFeatures(document.languageId);

    // Get import statements and other global context
    const imports = languageFeatures.getImportStatements(document.getText());
    const projectContext = await this.getProjectContext(document);

    return {
      contextText: [imports, projectContext, contextText]
        .filter(Boolean)
        .join("\n"),
      indentation,
      currentLineText: currentLine.text,
      isInComment: languageFeatures.isPositionInComment(document, position),
      isInString: languageFeatures.isPositionInString(document, position),
    };
  }

  private async getProjectContext(
    document: vscode.TextDocument
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration("autogem");
    if (!config.get<boolean>("useProjectContextForMultiline", true)) {
      return "";
    }

    try {
      // Get the current workspace folder
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        return "";
      }

      // Find key files in the project
      const filePattern = `**/*.${document.languageId}`;
      const maxRelatedFiles = config.get<number>(
        "maxRelatedFilesForMultiline",
        5
      );

      const files = await vscode.workspace.findFiles(
        filePattern,
        "**/node_modules/**",
        maxRelatedFiles
      );

      let projectContext = "";

      // Focus on key project files like types, interfaces, and similar patterns
      for (const file of files) {
        if (file.fsPath !== document.uri.fsPath) {
          const relatedDoc = await vscode.workspace.openTextDocument(file);
          const relatedPath = vscode.workspace.asRelativePath(file);

          const languageFeatures = new LanguageFeatures(relatedDoc.languageId);
          const relevantContent =
            languageFeatures.getProjectContextForMultiline(
              relatedDoc.getText()
            );

          if (relevantContent) {
            projectContext += `\n// From ${relatedPath}:\n${relevantContent}\n`;
          }
        }
      }

      return projectContext;
    } catch (error) {
      this.logger.warn("Error getting project context for multiline", error);
      return "";
    }
  }

  private shouldTriggerMultilineCompletion(
    contextData: any,
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    const config = vscode.workspace.getConfiguration("autogem");

    // Skip if inside comments or strings
    if (contextData.isInComment || contextData.isInString) {
      return false;
    }

    // Check if the current position is at an appropriate location for multiline completion
    const languageFeatures = new LanguageFeatures(document.languageId);
    const isAppropriateLocation =
      languageFeatures.isAppropriateMultilineLocation(
        document,
        position,
        contextData.currentLineText
      );

    return isAppropriateLocation;
  }

  private applyIndentation(
    suggestion: string,
    baseIndentation: string
  ): string {
    // Split the suggestion into lines
    const lines = suggestion.split("\n");

    // If it's a single line, no need for special indentation
    if (lines.length <= 1) {
      return suggestion;
    }

    // Process each line to ensure proper indentation
    return lines
      .map((line, index) => {
        // Skip indentation for the first line as it continues from the current cursor position
        if (index === 0) {
          return line;
        }

        // For empty lines, just return the line
        if (!line.trim()) {
          return line;
        }

        // Preserve any additional indentation in the suggestion beyond the first line
        const lineIndent = line.match(/^\s*/)?.[0] || "";

        // If the line already has indentation, determine if we need to add more
        if (lineIndent) {
          // If the model provided correct indentation, use it
          if (line.startsWith(baseIndentation)) {
            return line;
          }

          // Otherwise, replace the existing indentation with the base indentation plus
          // the relative indentation from the suggestion
          const relativeIndent = lineIndent;
          return baseIndentation + line.substring(relativeIndent.length);
        }

        // Add base indentation to the line
        return baseIndentation + line;
      })
      .join("\n");
  }
}
