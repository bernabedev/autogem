import { Content } from "@google/generative-ai";
import * as vscode from "vscode";

/**
 * Debounce function to delay execution until a pause in user input.
 * Useful for reducing excessive API calls.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
) {
  let timer: NodeJS.Timeout;
  return (...args: Parameters<T>): Promise<ReturnType<T>> =>
    new Promise((resolve) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => resolve(fn(...args)), delay);
    });
}

/**
 * Call the Gemini API to generate a suggestion.
 */
export async function generateSuggestion(
  prompt: string,
  model: any,
  token: vscode.CancellationToken
): Promise<string> {
  const contents: Content[] = [{ role: "user", parts: [{ text: prompt }] }];
  const { response } = await model.generateContent({ contents });
  const suggestion = response.text().trim();
  return suggestion;
}

/**
 * Debounced version of the generateSuggestion function.
 */
export const debouncedGenerateSuggestion = debounce(generateSuggestion, 400);

/**
 * In-memory cache for suggestions.
 */
const suggestionCache = new Map<string, string>();

/**
 * Get a cache key for a given prompt.
 * (For a production scenario, consider hashing the prompt.)
 */
export function getCacheKey(prompt: string): string {
  return prompt;
}

/**
 * Retrieve a cached suggestion or call the API if not available.
 */
export async function getCachedSuggestion(
  prompt: string,
  model: any,
  token: vscode.CancellationToken
): Promise<string> {
  const key = getCacheKey(prompt);
  if (suggestionCache.has(key)) {
    return suggestionCache.get(key)!;
  }
  const suggestion = await debouncedGenerateSuggestion(prompt, model, token);
  suggestionCache.set(key, suggestion);
  return suggestion;
}

/**
 * Simple rate limiter to avoid saturating the Gemini API.
 */
let callCount = 0;
const MAX_CALLS_PER_MINUTE = 60;

// Reset the call count every minute.
setInterval(() => {
  callCount = 0;
}, 60000);

/**
 * Check if an API call can be made based on the current rate limit.
 */
export function rateLimitCheck(): boolean {
  if (callCount >= MAX_CALLS_PER_MINUTE) {
    return false;
  }
  callCount++;
  return true;
}
