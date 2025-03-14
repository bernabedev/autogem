import * as vscode from "vscode";
import { CodeActionsProvider } from "./helpers/code-actions-provider";
import { LanguageFeatures } from "./helpers/language-features";
import { LoggingService } from "./helpers/logging-service";
import { ModelManager } from "./helpers/model-manager";
import { MultilineCompletionProvider } from "./helpers/multiline-provider";
import { StatusBarManager } from "./helpers/status-bar";
import { TelemetryReporter } from "./helpers/telemetry-reporter";
import { rateLimitCheck } from "./helpers/utils";

// Global services
let modelManager: ModelManager;
let statusBar: StatusBarManager;
let logger: LoggingService;
let telemetry: TelemetryReporter;
let providerDisposable: vscode.Disposable | null = null;
let multilineProviderDisposable: vscode.Disposable | null = null;
let codeActionsDisposable: vscode.Disposable | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  logger = new LoggingService(context);
  logger.info("AutoGem extension activating");

  statusBar = new StatusBarManager(context);
  telemetry = new TelemetryReporter(context, logger);
  modelManager = new ModelManager(context, logger);

  // Register configuration change handler
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("autogem")) {
        updateConfiguration();
      }
    })
  );

  // Register providers
  registerProviders(context);

  // Register commands
  registerCommands(context);

  // Initialize status bar
  statusBar.update(true);

  // Show welcome message for first-time users
  const hasShownWelcome = context.globalState.get<boolean>(
    "autogem.hasShownWelcome"
  );
  if (!hasShownWelcome) {
    showWelcomeMessage(context);
  }

  logger.info("AutoGem extension activated successfully");
}

function registerProviders(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("autogem");

  // Register inline completion provider
  providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { scheme: "file" },
    new InlineCompletionProvider(modelManager, logger, telemetry)
  );
  context.subscriptions.push(providerDisposable);

  // Register multiline completion provider if enabled
  if (config.get<boolean>("enableMultilineCompletions", true)) {
    multilineProviderDisposable =
      vscode.languages.registerInlineCompletionItemProvider(
        { scheme: "file" },
        new MultilineCompletionProvider(modelManager, logger, telemetry)
      );
    context.subscriptions.push(multilineProviderDisposable);
  }

  // Register code actions provider if enabled
  if (config.get<boolean>("enableCodeActions", true)) {
    codeActionsDisposable = vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new CodeActionsProvider(modelManager, logger, telemetry),
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.Refactor,
          vscode.CodeActionKind.QuickFix,
        ],
      }
    );
    context.subscriptions.push(codeActionsDisposable);
  }
}

function registerCommands(context: vscode.ExtensionContext) {
  // Basic commands
  context.subscriptions.push(
    vscode.commands.registerCommand("autogem.enable", () =>
      enableExtension(context)
    ),
    vscode.commands.registerCommand("autogem.disable", disableExtension),
    vscode.commands.registerCommand("autogem.toggleStatusBar", () =>
      statusBar.toggle(context)
    ),
    vscode.commands.registerCommand("autogem.viewLogs", () =>
      logger.showOutputChannel()
    ),
    vscode.commands.registerCommand("autogem.clearCache", () => {
      modelManager.clearCache();
      vscode.window.showInformationMessage(
        "AutoGem cache cleared successfully."
      );
    }),
    vscode.commands.registerCommand("autogem.configureApiKey", configureApiKey),
    vscode.commands.registerCommand("autogem.selectModel", () =>
      modelManager.selectModel()
    ),
    vscode.commands.registerCommand(
      "autogem.generateDocumentation",
      generateDocumentation
    ),
    vscode.commands.registerCommand("autogem.explainCode", explainSelectedCode)
  );
}

async function enableExtension(context: vscode.ExtensionContext) {
  if (!providerDisposable) {
    registerProviders(context);
    statusBar.update(true);
    telemetry.trackEvent("extension_enabled");
    vscode.window.showInformationMessage("AutoGem enabled successfully.");
  } else {
    vscode.window.showInformationMessage("AutoGem is already enabled.");
  }
}

async function disableExtension() {
  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;

    if (multilineProviderDisposable) {
      multilineProviderDisposable.dispose();
      multilineProviderDisposable = null;
    }

    if (codeActionsDisposable) {
      codeActionsDisposable.dispose();
      codeActionsDisposable = null;
    }

    statusBar.update(false);
    telemetry.trackEvent("extension_disabled");
    vscode.window.showInformationMessage("AutoGem disabled.");
  } else {
    vscode.window.showInformationMessage("AutoGem is already disabled.");
  }
}

async function updateConfiguration() {
  logger.info("Configuration changed, updating providers");

  // Dispose existing providers
  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;
  }

  if (multilineProviderDisposable) {
    multilineProviderDisposable.dispose();
    multilineProviderDisposable = null;
  }

  if (codeActionsDisposable) {
    codeActionsDisposable.dispose();
    codeActionsDisposable = null;
  }

  // Re-register providers with new configuration
  const extension = vscode.extensions.getExtension("autogem");
  if (extension) {
    registerProviders(extension.exports.context);
  }
  statusBar.update(true);
}

async function configureApiKey() {
  const config = vscode.workspace.getConfiguration("autogem");
  const currentKey = config.get<string>("apiKey", "");

  const apiKey = await vscode.window.showInputBox({
    prompt: "Enter your Google Gemini API key",
    password: true,
    value: currentKey,
  });

  if (apiKey !== undefined) {
    await config.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
    if (apiKey && apiKey.trim() !== "") {
      vscode.window.showInformationMessage("API key configured successfully!");
      telemetry.trackEvent("api_key_configured");
    }
  }
}

async function generateDocumentation() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor found.");
    return;
  }

  const selection = editor.selection;
  const code = editor.document.getText(
    selection.isEmpty ? undefined : selection
  );

  if (!code || code.trim() === "") {
    vscode.window.showWarningMessage("No code selected or file is empty.");
    return;
  }

  try {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating documentation...",
        cancellable: true,
      },
      async (progress, token) => {
        const documentation = await modelManager.generateDocumentation(
          code,
          editor.document.languageId,
          token
        );

        if (token.isCancellationRequested) {
          return;
        }

        const docEditor = await vscode.workspace.openTextDocument({
          content: documentation,
          language: "markdown",
        });

        await vscode.window.showTextDocument(docEditor, {
          viewColumn: vscode.ViewColumn.Beside,
        });
        telemetry.trackEvent("documentation_generated");
      }
    );
  } catch (error) {
    logger.error("Documentation generation failed", error);
    vscode.window.showErrorMessage(
      `Failed to generate documentation: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function explainSelectedCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor found.");
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage("Please select code to explain.");
    return;
  }

  const code = editor.document.getText(selection);

  try {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing code...",
        cancellable: true,
      },
      async (progress, token) => {
        const explanation = await modelManager.explainCode(
          code,
          editor.document.languageId,
          token
        );

        if (token.isCancellationRequested) {
          return;
        }

        const explainEditor = await vscode.workspace.openTextDocument({
          content: explanation,
          language: "markdown",
        });

        await vscode.window.showTextDocument(explainEditor, {
          viewColumn: vscode.ViewColumn.Beside,
        });
        telemetry.trackEvent("code_explained");
      }
    );
  } catch (error) {
    logger.error("Code explanation failed", error);
    vscode.window.showErrorMessage(
      `Failed to explain code: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

async function showWelcomeMessage(context: vscode.ExtensionContext) {
  const configureAction = "Configure API Key";
  const showDocsAction = "Show Documentation";

  const result = await vscode.window.showInformationMessage(
    "Welcome to AutoGem - Advanced AI Code Completion! To get started, you'll need to configure your Google Gemini API key.",
    configureAction,
    showDocsAction
  );

  if (result === configureAction) {
    await configureApiKey();
  } else if (result === showDocsAction) {
    vscode.env.openExternal(
      vscode.Uri.parse(
        "https://github.com/yourusername/autogem/blob/main/README.md"
      )
    );
  }

  await context.globalState.update("autogem.hasShownWelcome", true);
}

// Inline Completion Provider class
class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
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
    const apiKey = config.get<string>("apiKey");

    if (!apiKey || apiKey.trim() === "") {
      vscode.window.showErrorMessage(
        "AutoGem: Please configure your Google Gemini API key in settings."
      );
      return [];
    }

    // Check if autocompletion is enabled for this language
    const language = document.languageId;
    const enabledLanguages = config.get<string[]>("enabledLanguages", ["*"]);
    if (
      !enabledLanguages.includes("*") &&
      !enabledLanguages.includes(language)
    ) {
      this.logger.debug(
        `Skipping completion for disabled language: ${language}`
      );
      return [];
    }

    // Check rate limit before making an API call
    if (!rateLimitCheck()) {
      // Use status bar to show rate limit message instead of popup
      statusBar.showMessage("Rate limit exceeded", 3000);
      return [];
    }

    try {
      // Get the context around the cursor position
      const contextData = await this.getContextData(document, position, config);

      // Handle triggering conditions
      if (!this.shouldTriggerCompletion(contextData, context)) {
        return [];
      }

      this.logger.debug(
        `Requesting completion for ${language} at line ${position.line + 1}`
      );

      // Get suggestions from model manager
      const suggestions = await this.modelManager.getInlineCompletions(
        contextData.contextText,
        document.languageId,
        position,
        token
      );

      if (token.isCancellationRequested || !suggestions.length) {
        return [];
      }

      // Transform suggestions into VS Code inline completion items
      const items = suggestions.map((suggestion) => ({
        insertText: new vscode.SnippetString(suggestion),
        range: new vscode.Range(position, position),
      }));

      // Track successful completion generation
      this.telemetry.trackEvent("completion_generated", { language });

      return {
        items: items.map((item) => ({
          ...item,
          command: {
            title: "AutoGem: Accept Completion",
            command: "autogem.trackAcceptedCompletion",
            arguments: [{ language }],
          },
        })),
      };
    } catch (error: unknown) {
      this.handleError(error);
      return [];
    }
  }

  private async getContextData(
    document: vscode.TextDocument,
    position: vscode.Position,
    config: vscode.WorkspaceConfiguration
  ) {
    // Get a configurable context: last N lines before the cursor
    const contextLineCount = config.get<number>("contextLineCount", 50);
    const contextTokenCount = config.get<number>("contextTokenCount", 2000);
    const includeImports = config.get<boolean>("includeImportsInContext", true);

    // Get language-specific features
    const languageFeatures = new LanguageFeatures(document.languageId);

    // Get visible editors to collect project context if enabled
    const projectContext = config.get<boolean>("useProjectContext", true)
      ? await this.getProjectContext(document, position)
      : "";

    // Get the immediate context around cursor
    const startLine = Math.max(0, position.line - contextLineCount);
    const contextRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      position
    );

    // Get import statements if requested
    let importStatements = "";
    if (includeImports) {
      importStatements = languageFeatures.getImportStatements(
        document.getText()
      );
    }

    // Get current function/class context
    const currentScope = languageFeatures.getCurrentScope(document, position);

    // Combine all context
    const immediateContext = document.getText(contextRange);

    return {
      contextText: [
        importStatements,
        projectContext,
        currentScope,
        immediateContext,
      ]
        .filter(Boolean)
        .join("\n"),
      currentLine: document.lineAt(position.line).text,
      cursorPosition: position,
      indentation: document.lineAt(position.line).text.match(/^\s*/)?.[0] || "",
      isInComment: languageFeatures.isPositionInComment(document, position),
      isInString: languageFeatures.isPositionInString(document, position),
    };
  }

  private async getProjectContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration("autogem");
    if (!config.get<boolean>("useProjectContext", true)) {
      return "";
    }

    try {
      // Get the current workspace folder
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!workspaceFolder) {
        return "";
      }

      // Get file path relative to workspace
      const relativePath = vscode.workspace.asRelativePath(document.uri);

      // Find related files in the project
      const filePattern = `**/*.${document.languageId}`;
      const maxRelatedFiles = config.get<number>("maxRelatedFiles", 3);

      const files = await vscode.workspace.findFiles(
        filePattern,
        "**/node_modules/**",
        maxRelatedFiles
      );

      let projectContext = "";

      // Read contents of related files (excluding the current file)
      for (const file of files) {
        if (file.fsPath !== document.uri.fsPath) {
          const relatedDoc = await vscode.workspace.openTextDocument(file);
          const relatedPath = vscode.workspace.asRelativePath(file);

          // Extract relevant imports and declarations
          const languageFeatures = new LanguageFeatures(relatedDoc.languageId);
          const declarations = languageFeatures.getGlobalDeclarations(
            relatedDoc.getText()
          );

          if (declarations) {
            projectContext += `\n// From ${relatedPath}:\n${declarations}\n`;
          }
        }
      }

      return projectContext;
    } catch (error) {
      this.logger.warn("Error getting project context", error);
      return "";
    }
  }

  private shouldTriggerCompletion(
    contextData: any,
    context: vscode.InlineCompletionContext
  ): boolean {
    const config = vscode.workspace.getConfiguration("autogem");

    // Skip if inside comments or strings if configured
    if (
      config.get<boolean>("skipInComments", true) &&
      contextData.isInComment
    ) {
      return false;
    }

    if (config.get<boolean>("skipInStrings", false) && contextData.isInString) {
      return false;
    }

    // Check for trigger characters
    const triggerCharacters = config.get<string[]>("triggerCharacters", [
      ".",
      "(",
      "{",
    ]);
    const currentLine = contextData.currentLine;

    // Check if the line ends with a trigger character
    const endsWithTrigger = triggerCharacters.some((char) =>
      currentLine.trimRight().endsWith(char)
    );

    // Explicit trigger (user requested completion)
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
      return true;
    }

    // Trigger on specific characters
    if (endsWithTrigger) {
      return true;
    }

    // Trigger after a delay during typing
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // Check if we have enough content to provide useful suggestions
      if (
        currentLine.trim().length >= config.get<number>("minTriggerLength", 3)
      ) {
        return true;
      }
    }

    return false;
  }

  private handleError(error: unknown): void {
    this.logger.error("Error in completion provider", error);

    // Don't show UI error message for every completion error
    // Only log it for debugging purposes
    if (error instanceof Error) {
      if (
        error.message.includes("rate limit") ||
        error.message.includes("quota")
      ) {
        statusBar.showMessage("Rate limit exceeded", 3000);
      }
    }
  }
}

export function deactivate() {
  // Log deactivation
  if (logger) {
    logger.info("Deactivating AutoGem extension");
  }

  // Dispose of all registered providers
  if (providerDisposable) {
    providerDisposable.dispose();
    providerDisposable = null;
  }

  if (multilineProviderDisposable) {
    multilineProviderDisposable.dispose();
    multilineProviderDisposable = null;
  }

  if (codeActionsDisposable) {
    codeActionsDisposable.dispose();
    codeActionsDisposable = null;
  }

  // Clean up any other resources
  if (statusBar) {
    statusBar.dispose();
  }

  if (telemetry) {
    telemetry.dispose();
  }
}
