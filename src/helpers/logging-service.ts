import * as vscode from "vscode";

/**
 * LoggingService - Handles logging for the AutoGem extension.
 */
export class LoggingService {
  private outputChannel: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("AutoGem");
  }

  info(message: string, error?: unknown) {
    this.log("INFO", message, error);
  }

  warn(message: string, error?: unknown) {
    this.log("WARN", message, error);
  }

  error(message: string, error?: unknown) {
    this.log("ERROR", message);
    if (error instanceof Error) {
      this.log("ERROR", error.message);
      if (error.stack) {
        this.log("ERROR", error.stack);
      }
    }
  }

  debug(message: string, error?: unknown) {
    const config = vscode.workspace.getConfiguration("autogem");
    if (config.get<boolean>("enableDebugLogging", false)) {
      this.log("DEBUG", message, error);
    }
  }

  private log(level: string, message: string, error?: unknown) {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    if (error instanceof Error) {
      this.outputChannel.appendLine(error.message);
      if (error.stack) {
        this.outputChannel.appendLine(error.stack);
      }
    }
  }

  showOutputChannel() {
    this.outputChannel.show();
  }

  dispose() {
    this.outputChannel.dispose();
  }
}
