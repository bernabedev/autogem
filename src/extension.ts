import { GoogleGenerativeAI } from "@google/generative-ai";
import * as vscode from "vscode";
import { getCachedSuggestion, rateLimitCheck } from "./utils";

let providerDisposable: vscode.Disposable | null = null;

export function activate(context: vscode.ExtensionContext) {
  const registerProvider = () => {
    providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      {
        provideInlineCompletionItems: async (
          document,
          position,
          _context,
          token
        ) => {
          const config = vscode.workspace.getConfiguration("autogem");
          const apiKey = config.get<string>("apiKey");

          if (!apiKey || apiKey.trim() === "") {
            vscode.window.showErrorMessage(
              "Gemini Autocomplete: Please configure your Google Gemini API key in settings."
            );
            return [];
          }

          // Check rate limit before making an API call.
          if (!rateLimitCheck()) {
            vscode.window.showWarningMessage(
              "Rate limit exceeded. Please wait."
            );
            return [];
          }

          const genAI = new GoogleGenerativeAI(apiKey);

          // Get the code context from the start of the document to the cursor.
          const range = new vscode.Range(new vscode.Position(0, 0), position);
          const contextText = document.getText(range);
          const language = document.languageId;

          // Construct the prompt with clear instructions.
          const prompt = `You are a top-notch programming assistant specializing in code auto-completion. Based on this ${language} code snippet and context, generate the most likely continuation that a skilled developer would write.

					Rules:
					1. Output ONLY pure code—no explanations, comments, or non-code text.
					2. Complete ONLY the currently unfinished statement/expression.
					3. Analyze indentation patterns, variable naming conventions, and coding style to match the existing codebase.
					4. Consider common patterns for the identified language and function context.
					5. Limit output to 150 characters maximum.
					6. If multiple completions are plausible, provide the most probable one based on context.
					7. Respect established patterns in the codebase (e.g., if camelCase is used, continue with camelCase).
					8. End the completion at a logical point (semicolon, closing bracket, etc.)
					
					Code context:
					${contextText}`;

          try {
            const modelName = config.get<string>("model") ?? "gemini-2.0-flash";
            const model = genAI.getGenerativeModel({
              model: modelName,
              generationConfig: {
                maxOutputTokens: 50,
              },
            });

            // Retrieve the suggestion via the caching utility.
            const suggestion = await getCachedSuggestion(prompt, model, token);
            console.log({ suggestion });
            return [
              {
                insertText: new vscode.SnippetString(suggestion),
                range: new vscode.Range(position, position),
              },
            ];
          } catch (error: unknown) {
            if (error instanceof Error) {
              vscode.window.showErrorMessage(
                `Error generating code completion: ${error.message}`
              );
            } else {
              vscode.window.showErrorMessage(
                "An unknown error occurred while generating code completion."
              );
            }
            return [];
          }
        },
      }
    );
    context.subscriptions.push(providerDisposable);
  };

  vscode.commands.registerCommand("autogem.enable", () => {
    if (!providerDisposable) {
      registerProvider();
      vscode.window.showInformationMessage("Gemini Autocomplete enabled.");
    } else {
      vscode.window.showInformationMessage(
        "Gemini Autocomplete is already enabled."
      );
    }
  });

  vscode.commands.registerCommand("autogem.disable", () => {
    if (providerDisposable) {
      providerDisposable.dispose();
      providerDisposable = null;
      vscode.window.showInformationMessage("Gemini Autocomplete disabled.");
    } else {
      vscode.window.showInformationMessage(
        "Gemini Autocomplete is already disabled."
      );
    }
  });

  // Automatically register the provider when the extension is activated.
  registerProvider();
}

export function deactivate() {
  if (providerDisposable) {
    providerDisposable.dispose();
  }
}
