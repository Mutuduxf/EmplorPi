import type { ToolDefinition } from "@earendil-works/agent-base";

/**
 * Web search tool — lets the agent search the web via a configurable endpoint.
 *
 * The search endpoint is read from SEARCH_API_URL env var, or defaults to
 * DuckDuckGo's lite API. For production, set SEARCH_API_KEY and
 * SEARCH_API_URL to your preferred search provider.
 */

const SEARCH_URL = process.env.SEARCH_API_URL || "https://lite.duckduckgo.com/lite/";

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information. Use this when you need up-to-date data, news, or facts beyond your training.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  },
  execute: async (args: { query: string }) => {
    try {
      const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(args.query)}`, {
        headers: { "User-Agent": "Finance-Agent/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();

      // Strip HTML tags for a cleaner result
      const clean = text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);

      return {
        content: [{ type: "text" as const, text: clean || "No results found." }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Search failed: ${msg}` }],
        isError: true,
      };
    }
  },
};
