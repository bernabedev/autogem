import * as vscode from "vscode";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private messageTimeout: NodeJS.Timeout | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "autogem.toggleStatusBar";
    this.context.subscriptions.push(this.statusBarItem);
    this.update(true);
  }

  public update(isEnabled: boolean): void {
    const config = vscode.workspace.getConfiguration("autogem");
    const showStatusBar = config.get<boolean>("showStatusBar", true);

    if (!showStatusBar) {
      this.statusBarItem.hide();
      return;
    }

    if (isEnabled) {
      this.statusBarItem.text = "$(sparkle) AutoGem";
      this.statusBarItem.tooltip = "AutoGem is enabled. Click to disable.";
    } else {
      this.statusBarItem.text = "$(circle-slash) AutoGem";
      this.statusBarItem.tooltip = "AutoGem is disabled. Click to enable.";
    }

    this.statusBarItem.show();
  }

  public async toggle(context: vscode.ExtensionContext): Promise<void> {
    const isDisabled = this.statusBarItem.text.includes("circle-slash");
    const command = isDisabled ? "autogem.enable" : "autogem.disable";
    await vscode.commands.executeCommand(command, context);
  }

  public showMessage(message: string, durationMs: number = 3000): void {
    // Clear any existing timeout
    if (this.messageTimeout) {
      clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }

    // Show message
    this.statusBarItem.text = message;
    this.statusBarItem.show();

    // Hide after duration
    this.messageTimeout = setTimeout(() => {
      this.statusBarItem.hide();
      this.messageTimeout = null;
    }, durationMs);
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
