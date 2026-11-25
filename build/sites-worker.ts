import {runWithBackground} from "../lib/background";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithBackground(ctx, () => runWithConnectorBinding(binding, async () => {
      const operation = handler.fetch(request, env, ctx);
      // A tab navigation or dropped connection must not abandon a leased batch
      // before its checkpoint and lease release have committed.
      if (request.method === "POST" && ["/api/cloud-step", "/mcp", "/api/stock", "/api/stock/setup"].includes(new URL(request.url).pathname)) {
        ctx.waitUntil(operation.then(() => undefined, () => undefined));
      }
      const response = await operation;
      // HTML must not keep references to assets removed by the next deployment.
      if (response.headers.get("Content-Type")?.includes("text/html")) {
        const fresh = new Response(response.body, response);
        fresh.headers.set("Cache-Control", "no-store");
        return fresh;
      }
      return response;
    }));
  },
};
