/**
 * Domain tools — replace this file with your own ToolExecutor.
 *
 * Each tool has a name, description, parameter schema (TypeBox),
 * and an execute() method that runs the actual business logic.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolExecutor, ToolExecuteResult } from "@earendil-works/agent-base";
import { Type } from "@earendil-works/pi-ai";

export class MyDomainTools implements ToolExecutor {
  getTools(): AgentTool[] {
    return [
      {
        name: "example_tool",
        description: "An example tool — replace with your domain tools",
        parameters: Type.Object({
          query: Type.String({ description: "A query parameter" }),
        }),
      },
    ];
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecuteResult> {
    switch (name) {
      case "example_tool":
        return {
          content: [{ type: "text", text: `You said: ${args.query}` }],
          isError: false,
        };
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  }
}
