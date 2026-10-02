import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({
    name: "Tamer RED TEAM Council Test",
    version: "1.0.0"
  });

  server.registerTool(
    "hello",
    {
      description: "Test whether the MCP connection works",
      inputSchema: {
        name: z.string().optional()
      }
    },
    async ({ name }) => ({
      content: [
        {
          type: "text",
          text: `Hello ${name ?? "Tamer"}! MCP is working.`
        }
      ]
    })
  );

  return server;
}

export default {
  fetch(request, env, ctx) {
    return createMcpHandler(createServer)(request, env, ctx);
  }
};
