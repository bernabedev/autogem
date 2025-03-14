import * as vscode from "vscode";

export class LanguageFeatures {
  constructor(private languageId: string) {}

  /**
   * Checks if the given position is inside a comment
   */
  isPositionInComment(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    // Simplified comment detection for common languages
    const line = document.lineAt(position.line).text;

    // Handle single-line comments
    switch (this.languageId) {
      case "javascript":
      case "typescript":
      case "java":
      case "c":
      case "cpp":
      case "csharp":
      case "go":
      case "rust":
      case "swift":
      case "php":
        // Check for // comments
        const singleCommentPos = line.indexOf("//");
        if (singleCommentPos >= 0 && position.character > singleCommentPos) {
          return true;
        }
        break;
      case "python":
      case "ruby":
      case "shell":
      case "bash":
      case "yaml":
        // Check for # comments
        const hashCommentPos = line.indexOf("#");
        if (hashCommentPos >= 0 && position.character > hashCommentPos) {
          return true;
        }
        break;
      case "html":
      case "xml":
        // Check for <!-- comments -->
        const htmlCommentStart = line.indexOf("<!--");
        const htmlCommentEnd = line.indexOf("-->");
        if (
          htmlCommentStart >= 0 &&
          position.character > htmlCommentStart &&
          (htmlCommentEnd < 0 || position.character < htmlCommentEnd)
        ) {
          return true;
        }
        break;
    }

    // TODO: Add multi-line comment detection with tokenization
    // This would require more sophisticated parsing

    return false;
  }

  /**
   * Checks if the given position is inside a string
   */
  isPositionInString(
    document: vscode.TextDocument,
    position: vscode.Position
  ): boolean {
    // Simplified string detection - counts quotes before the current position
    const line = document.lineAt(position.line).text;
    const textBeforeCursor = line.substring(0, position.character);

    // Handle string detection based on language
    switch (this.languageId) {
      case "javascript":
      case "typescript":
      case "java":
      case "c":
      case "cpp":
      case "csharp":
      case "go":
      case "rust":
      case "swift":
      case "php":
      case "python":
      case "ruby":
        // Count quotes to determine if we're in a string
        const singleQuotes = (textBeforeCursor.match(/'/g) || []).length;
        const doubleQuotes = (textBeforeCursor.match(/"/g) || []).length;
        const backticks = (textBeforeCursor.match(/`/g) || []).length;

        // If we have an odd number of quotes, we're in a string
        return (
          singleQuotes % 2 !== 0 ||
          doubleQuotes % 2 !== 0 ||
          backticks % 2 !== 0
        );
      default:
        return false;
    }
  }

  /**
   * Gets import statements and other global declarations from the document
   */
  getImportStatements(documentText: string): string {
    const lines = documentText.split("\n");
    const imports: string[] = [];

    // Handle import detection based on language
    switch (this.languageId) {
      case "javascript":
      case "typescript":
        // Match import statements and export declarations
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("import ") ||
            trimmed.startsWith("export ") ||
            trimmed.startsWith("require(")
          ) {
            imports.push(line);
          }
        }
        break;
      case "python":
        // Match import statements, from imports, and global constants
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("import ") ||
            trimmed.startsWith("from ") ||
            trimmed.match(/^[A-Z][A-Z0-9_]* *= *[^=]/)
          ) {
            imports.push(line);
          }
        }
        break;
      case "java":
      case "kotlin":
        // Match package and import statements
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("package ") || trimmed.startsWith("import ")) {
            imports.push(line);
          }
        }
        break;
      case "go":
        // Match package and import statements
        let inImportBlock = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("package ")) {
            imports.push(line);
          } else if (trimmed.startsWith('import "') || trimmed === "import (") {
            inImportBlock = true;
            imports.push(line);
          } else if (inImportBlock) {
            imports.push(line);
            if (trimmed === ")" || trimmed.endsWith(")")) {
              inImportBlock = false;
            }
          }
        }
        break;
      case "rust":
        // Match use statements and crate attributes
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("use ") ||
            trimmed.startsWith("#[") ||
            trimmed.startsWith("extern crate ")
          ) {
            imports.push(line);
          }
        }
        break;
    }

    return imports.join("\n");
  }

  /**
   * Gets the current function, class, or block context at the given position
   */
  getCurrentScope(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    // Get the text up to the current position
    const textRange = new vscode.Range(new vscode.Position(0, 0), position);
    const textBefore = document.getText(textRange);

    // Split into lines
    const lines = textBefore.split("\n");

    // Analyze indentation to find the current scope
    const currentIndent = lines[position.line].match(/^\s*/)?.[0].length || 0;
    const scopeLines: string[] = [];

    // Start from the current line and work backwards
    for (let i = position.line; i >= 0; i--) {
      const line = lines[i];
      const lineIndent = line.match(/^\s*/)?.[0].length || 0;

      // If we find a line with less indentation, it might be the start of our scope
      if (lineIndent < currentIndent) {
        // Check if this line starts a block (class, function, if, etc.)
        const trimmed = line.trim();
        if (this.isBlockStart(trimmed)) {
          // Found the start of our scope
          for (let j = i; j <= position.line; j++) {
            scopeLines.push(lines[j]);
          }
          break;
        }
      }

      // If we've gone back 30 lines and still haven't found the scope start,
      // just include the last 30 lines as context
      if (position.line - i >= 30 && scopeLines.length === 0) {
        for (let j = Math.max(0, position.line - 30); j <= position.line; j++) {
          scopeLines.push(lines[j]);
        }
        break;
      }
    }

    return scopeLines.join("\n");
  }

  /**
   * Checks if the given line starts a code block
   */
  private isBlockStart(line: string): boolean {
    // Check for common block starters across languages
    switch (this.languageId) {
      case "javascript":
      case "typescript":
      case "java":
      case "c":
      case "cpp":
      case "csharp":
        return Boolean(
          line.match(
            /^(function|class|if|for|while|switch|try|else if|else|do)\b/
          ) ||
            line.match(/^[a-zA-Z0-9_$]+\s*\([^)]*\)\s*{/) ||
            line.match(/=>\s*{/) ||
            line.match(/\(\s*\)\s*{/) ||
            line.match(/\{\s*$/)
        );
      case "python":
        return Boolean(
          line.match(
            /^(def|class|if|for|while|try|elif|else|except|with)\b.*:$/
          )
        );
      case "ruby":
        return Boolean(
          line.match(
            /^(def|class|module|if|unless|while|until|for|begin|case)\b/
          ) || line.match(/\bdo(\s*\|[^|]*\|)?\s*$/)
        );
      case "go":
        return Boolean(
          line.match(/^(func|type|if|for|switch|select|case|default)\b/) ||
            line.match(/\{\s*$/)
        );
      case "rust":
        return Boolean(
          line.match(
            /^(fn|struct|enum|impl|trait|if|while|for|loop|match)\b/
          ) || line.match(/\{\s*$/)
        );
      default:
        return Boolean(
          line.match(/^(function|class|if|for|while|try)\b/) ||
            line.match(/\{\s*$/)
        );
    }
  }

  /**
   * Gets global declarations and important patterns from the file for project context
   */
  getGlobalDeclarations(documentText: string): string {
    // Split the text into lines
    const lines = documentText.split("\n");
    const declarations: string[] = [];

    // Get the imports first
    const imports = this.getImportStatements(documentText);
    if (imports) {
      declarations.push(imports);
    }

    // Handle language-specific global declarations
    switch (this.languageId) {
      case "typescript":
        // Look for interfaces, types, classes, and enums
        let inDeclaration = false;
        let bracketCount = 0;
        let declarationLines: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();

          // Match interface, type, class, or enum declarations
          if (
            !inDeclaration &&
            (trimmed.startsWith("interface ") ||
              trimmed.startsWith("type ") ||
              trimmed.startsWith("class ") ||
              trimmed.startsWith("enum "))
          ) {
            inDeclaration = true;
            bracketCount = 0;
            declarationLines = [line];

            // Count opening brackets
            bracketCount += (trimmed.match(/\{/g) || []).length;
            bracketCount -= (trimmed.match(/\}/g) || []).length;

            // If the declaration is a one-liner, add it directly
            if (bracketCount === 0 && trimmed.includes(";")) {
              declarations.push(line);
              inDeclaration = false;
              declarationLines = [];
            }
          } else if (inDeclaration) {
            declarationLines.push(line);

            // Update bracket count
            bracketCount += (trimmed.match(/\{/g) || []).length;
            bracketCount -= (trimmed.match(/\}/g) || []).length;

            // If brackets are balanced, we've reached the end of the declaration
            if (bracketCount === 0) {
              // Add the complete declaration
              declarations.push(declarationLines.join("\n"));
              inDeclaration = false;
              declarationLines = [];
            }
          }
        }
        break;

      case "javascript":
        // Look for classes, exports, and global constants
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("class ") ||
            trimmed.startsWith("const ") ||
            trimmed.startsWith("export ")
          ) {
            declarations.push(line);
          }
        }
        break;

      case "python":
        // Look for classes and global constants
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("class ") ||
            trimmed.match(/^[A-Z][A-Z0-9_]* *= *[^=]/)
          ) {
            declarations.push(line);
          }
        }
        break;
    }

    return declarations.join("\n");
  }

  /**
   * Gets relevant parts of a file for multiline completion context
   */
  getProjectContextForMultiline(documentText: string): string {
    // For multiline completions, we focus on types, interfaces, function signatures
    switch (this.languageId) {
      case "typescript":
      case "javascript":
        const relevantParts: string[] = [];
        const regex =
          /(interface|type|class|enum)\s+(\w+)([^{]*\{[^}]*\}|[^;]*;)/g;

        let match;
        while ((match = regex.exec(documentText)) !== null) {
          relevantParts.push(match[0]);
        }

        return relevantParts.join("\n\n");

      case "python":
        // Extract class definitions and function signatures
        const lines = documentText.split("\n");
        const classLines: string[] = [];
        let inClass = false;

        for (const line of lines) {
          if (line.trim().startsWith("class ")) {
            inClass = true;
            classLines.push(line);
          } else if (inClass && line.trim().startsWith("def ")) {
            classLines.push(line);
          } else if (inClass && line.trim() === "") {
            inClass = false;
          }
        }

        return classLines.join("\n");

      default:
        return "";
    }
  }

  /**
   * Checks if the current location is appropriate for a multiline completion
   */
  isAppropriateMultilineLocation(
    document: vscode.TextDocument,
    position: vscode.Position,
    currentLineText: string
  ): boolean {
    const trimmedLine = currentLineText.trim();

    // Language-specific checks
    switch (this.languageId) {
      case "javascript":
      case "typescript":
        // After opening brace, arrow function, function definition, or class definition
        return (
          trimmedLine.endsWith("{") ||
          trimmedLine.endsWith("=>") ||
          trimmedLine.endsWith("=> {") ||
          trimmedLine.match(/function\s*\([^)]*\)\s*{?\s*$/) !== null ||
          trimmedLine.match(/class\s+\w+(\s+extends\s+\w+)?\s*{?\s*$/) !== null
        );

      case "python":
        // After colon
        return (
          trimmedLine.endsWith(":") ||
          trimmedLine.match(/def\s+\w+\s*\([^)]*\)\s*:\s*$/) !== null ||
          trimmedLine.match(/class\s+\w+(\s*\([^)]*\))?\s*:\s*$/) !== null
        );

      case "java":
      case "kotlin":
      case "c":
      case "cpp":
      case "csharp":
        // After opening brace or method/class declaration
        return (
          trimmedLine.endsWith("{") ||
          trimmedLine.match(/\)\s*{?\s*$/) !== null ||
          trimmedLine.match(
            /class\s+\w+(\s+extends\s+\w+)?(\s+implements\s+\w+)?\s*{?\s*$/
          ) !== null
        );

      default:
        // Generic check for opening brace
        return trimmedLine.endsWith("{") || trimmedLine.endsWith(":");
    }
  }
}
