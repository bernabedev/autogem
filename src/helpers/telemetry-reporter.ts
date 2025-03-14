import * as vscode from "vscode";
import { LoggingService } from "./logging-service";

/**
 * TelemetryReporter - Handles telemetry events for the AutoGem extension.
 */
export class TelemetryReporter {
  private context: vscode.ExtensionContext;
  private logger: LoggingService;

  constructor(context: vscode.ExtensionContext, logger: LoggingService) {
    this.context = context;
    this.logger = logger;
  }

  trackEvent(eventName: string, properties?: Record<string, any>) {
    const config = vscode.workspace.getConfiguration("autogem");
    if (!config.get<boolean>("enableTelemetry", true)) {
      return;
    }

    this.logger.debug(`Tracking event: ${eventName}`);
    if (properties) {
      this.logger.debug(`Properties: ${JSON.stringify(properties)}`);
    }

    // Store telemetry event count for debugging
    const eventCount = this.context.globalState.get<number>(eventName, 0);
    this.context.globalState.update(eventName, eventCount + 1);
  }

  dispose() {
    this.logger.info("Disposing TelemetryReporter");
  }
}
