import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";
import * as vscode from "vscode";
import { LoggingService } from "./logging-service";
import { clearSuggestionCache, getCachedSuggestion } from "./utils";
// import { clearSuggestionCache, getCachedSuggestion } from "./utils";

export class ModelManager {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string = "gemini-1.5-pro";
  private availableModels = [
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.0-pro",
    "gemini-1.0-ultra",
  ];

  constructor(
    private context: vscode.ExtensionContext,
    private logger: LoggingService
  ) {
    this.initialize();
  }

  private initialize() {
    const config = vscode.workspace.getConfiguration("autogem");
    const apiKey = config.get<string>("apiKey");

    if (apiKey && apiKey.trim() !== "") {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.modelName = config.get<string>("model", "gemini-1.5-pro");
      this.logger.info(
        `Initialized model manager with model: ${this.modelName}`
      );
    } else {
      this.logger.warn(
        "API key not configured, model manager initialization deferred"
      );
    }
  }

  public async getInlineCompletions(
    context: string,
    language: string,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    if (!this.ensureInitialized()) {
      return [];
    }

    const config = vscode.workspace.getConfiguration("autogem");
    const maxSuggestions = config.get<number>("maxSuggestions", 1);
    const temperature = config.get<number>("temperature", 0.2);
    const maxTokens = config.get<number>("maxTokens", 50);

    // Build the prompt
    const prompt = this.buildInlineCompletionPrompt(context, language);

    try {
      const model = this.genAI!.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: 0.95,
          topK: 40,
          candidateCount: maxSuggestions,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
      });

      // Get cached suggestions
      const suggestions = await getCachedSuggestion(prompt, model, token);

      if (token.isCancellationRequested) {
        return [];
      }

      // If we have a single suggestion, return it
      if (typeof suggestions === "string") {
        return [this.sanitizeCompletion(suggestions)];
      }

      // If we have multiple suggestions, return them all
      if (Array.isArray(suggestions)) {
        return suggestions.map((s) => this.sanitizeCompletion(s));
      }

      // Otherwise, return an empty array
      return [];
    } catch (error) {
      this.logger.error("Error getting completions", error);
      throw error;
    }
  }

  public async getMultilineCompletions(
    context: string,
    language: string,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    if (!this.ensureInitialized()) {
      return [];
    }

    const config = vscode.workspace.getConfiguration("autogem");
    const maxSuggestions = config.get<number>("maxMultilineSuggestions", 1);
    const temperature = config.get<number>("multilineTemperature", 0.7);
    const maxTokens = config.get<number>("maxMultilineTokens", 300);

    // Build the prompt
    const prompt = this.buildMultilineCompletionPrompt(context, language);

    try {
      const model = this.genAI!.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
          topP: 0.95,
          topK: 40,
          candidateCount: maxSuggestions,
        },
      });

      // Get cached suggestions
      const suggestions = await getCachedSuggestion(prompt, model, token);

      if (token.isCancellationRequested) {
        return [];
      }

      // If we have a single suggestion, return it
      if (typeof suggestions === "string") {
        return [this.sanitizeCompletion(suggestions)];
      }

      // If we have multiple suggestions, return them all
      if (Array.isArray(suggestions)) {
        return suggestions.map((s) => this.sanitizeCompletion(s));
      }

      // Otherwise, return an empty array
      return [];
    } catch (error) {
      this.logger.error("Error getting multiline completions", error);
      throw error;
    }
  }

  public async generateDocumentation(
    code: string,
    language: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    if (!this.ensureInitialized()) {
      throw new Error("Model manager not initialized");
    }

    const prompt = `Generate comprehensive documentation for the following ${language} code. Include:
1. An overview of what the code does
2. Detailed explanations of key functions and classes
3. Parameters, return values, and examples where appropriate
4. Any assumptions or limitations

Code:
\`\`\`${language}
${code}
\`\`\`

Format the documentation in Markdown with proper headings, lists, and code blocks.`;

    try {
      const model = this.genAI!.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.2,
        },
      });

      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error("Error generating documentation", error);
      throw error;
    }
  }

  public async explainCode(
    code: string,
    language: string,
    token: vscode.CancellationToken
  ): Promise<string> {
    if (!this.ensureInitialized()) {
      throw new Error("Model manager not initialized");
    }

    const prompt = `Explain the following ${language} code in detail. Break down:
1. What the code does step by step
2. The purpose of each function and block
3. Any notable patterns or techniques used
4. Potential optimizations or improvements

Code:
\`\`\`${language}
${code}
\`\`\`

Format your explanation in clear, concise Markdown.`;

    try {
      const model = this.genAI!.getGenerativeModel({
        model: this.modelName,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.1,
        },
      });

      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error("Error explaining code", error);
      throw error;
    }
  }

  public async selectModel() {
    const selected = await vscode.window.showQuickPick(this.availableModels, {
      placeHolder: "Select Gemini model to use",
    });

    if (selected) {
      const config = vscode.workspace.getConfiguration("autogem");
      await config.update("model", selected, vscode.ConfigurationTarget.Global);
      this.modelName = selected;
      this.logger.info(`Changed model to: ${selected}`);
      vscode.window.showInformationMessage(
        `AutoGem: Changed model to ${selected}`
      );
    }
  }

  public clearCache() {
    clearSuggestionCache();
    this.logger.info("Cleared suggestion cache");
  }

  private ensureInitialized(): boolean {
    if (!this.genAI) {
      const config = vscode.workspace.getConfiguration("autogem");
      const apiKey = config.get<string>("apiKey");

      if (apiKey && apiKey.trim() !== "") {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.modelName = config.get<string>("model", "gemini-1.5-pro");
        return true;
      }

      return false;
    }

    return true;
  }

  private buildInlineCompletionPrompt(
    context: string,
    language: string
  ): string {
    return `You are an expert code assistant specializing in inline code completions. Given the following ${language} snippet, generate a minimal continuation that completes only the currently unfinished expression.

Rules:
1. Output ONLY pure code—no explanations, comments, or extra text.
2. Complete ONLY the unfinished statement/expression; do not add any additional lines.
3. Match the existing indentation, naming conventions, and coding style.
4. Adhere to common patterns and syntax of ${language} within the given context.
5. Limit the output to a maximum of 150 characters.
6. If multiple completions are plausible, choose the most likely based on context.
7. End at a natural termination point (e.g., semicolon, closing bracket).
8. If the fragment is already complete, return nothing.

Code context:
${context}`;
  }

  private buildMultilineCompletionPrompt(
    context: string,
    language: string
  ): string {
    return `You are an expert code assistant specializing in code completions. Given the following ${language} snippet, generate a logical continuation that completes the current function, class, or block.

Rules:
1. Output ONLY pure code—no explanations, comments, or markdown formatting.
2. Complete the current function, class, or block in a logical way.
3. Match the existing indentation, naming conventions, and coding style.
4. Adhere to common patterns and syntax of ${language} within the given context.
5. Include comments similar to the style of the existing code if appropriate.
6. Limit the output to a maximum of 25 lines.
7. If multiple completions are plausible, choose the most comprehensive based on context.
8. If the fragment is already complete, return nothing.

Code context:
${context}`;
  }
  private sanitizeCompletion(completion: string): string {
    // Remove common AI model response artifacts
    let sanitized = completion.trim();

    // Remove markdown code block markers if they exist
    sanitized = sanitized.replace(/^```[\w]*\n/, "").replace(/\n```$/, "");

    // Remove any explanatory text that might have been included
    if (sanitized.includes("\n\n")) {
      sanitized = sanitized.split("\n\n")[0];
    }

    return sanitized;
  }
}
