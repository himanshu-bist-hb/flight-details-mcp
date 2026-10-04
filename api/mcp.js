// Stateless MCP server (Streamable HTTP, JSON responses) for Vercel.
const { searchFlights } = require("./flights");

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "flight-details-mcp", version: "1.0.0" };

const commonProps = {
  departure_id: {
    type: "string",
    description: "Departure airport IATA code (e.g. DEL) or comma-separated codes",
  },
  arrival_id: {
    type: "string",
    description: "Arrival airport IATA code (e.g. GOI) or comma-separated codes",
  },
  outbound_date: { type: "string", description: "Departure date, YYYY-MM-DD" },
  return_date: {
    type: "string",
    description: "Return date YYYY-MM-DD. Omit for a one-way search.",
  },
  currency: { type: "string", description: "Currency code, default USD (e.g. INR)" },
  adults: { type: "integer", description: "Number of adult passengers, default 1" },
  max_price: { type: "integer", description: "Only return flights at or below this price" },
  stops: {
    type: "integer",
    description: "0 = any, 1 = nonstop only, 2 = 1 stop or fewer, 3 = 2 stops or fewer",
  },
  travel_class: {
    type: "integer",
    description: "1 = Economy (default), 2 = Premium economy, 3 = Business, 4 = First",
  },
  limit: { type: "integer", description: "Max flights to return (1-20, default 5)" },
};

const required = ["departure_id", "arrival_id", "outbound_date"];

const TOOLS = [
  {
    name: "find_cheapest_flights",
    description:
      "Find the most affordable flights between two airports on a date (one-way, or round trip if return_date is given). Results are sorted by price ascending, with the cheapest highlighted and Google's price insights (is this price low/typical/high).",
    inputSchema: { type: "object", properties: commonProps, required },
    handler: (a) => searchFlights({ ...a, sort_by: 2 }),
  },
  {
    name: "search_flights",
    description:
      "Search flights with full details (airlines, stops, layovers, duration, legs). Use find_cheapest_flights when the goal is the lowest price.",
    inputSchema: {
      type: "object",
      properties: {
        ...commonProps,
        sort_by: {
          type: "integer",
          description:
            "1 = Top flights (default Google ranking), 2 = Price, 3 = Departure time, 4 = Arrival time, 5 = Duration",
        },
      },
      required,
    },
    handler: (a) => searchFlights({ ...a, sort_by: a.sort_by || 1 }),
  },
];

function validate(args) {
  const missing = required.filter((k) => !args[k]);
  if (missing.length) return `Missing required argument(s): ${missing.join(", ")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.outbound_date)) return "outbound_date must be YYYY-MM-DD";
  if (args.return_date && !/^\d{4}-\d{2}-\d{2}$/.test(args.return_date))
    return "return_date must be YYYY-MM-DD";
  return null;
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ handler, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool: ${params?.name}`);
      const args = params.arguments || {};
      const problem = validate(args);
      if (problem) return ok({ isError: true, content: [{ type: "text", text: problem }] });
      try {
        const result = await tool.handler(args);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return ok({
          isError: true,
          content: [{ type: "text", text: `Flight search failed: ${e.message}` }],
        });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const token = process.env.MCP_AUTH_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    // Health check; no server-initiated SSE stream in stateless mode.
    if ((req.headers.accept || "").includes("text/event-stream")) return res.status(405).end();
    return res.status(200).json({ ...SERVER_INFO, status: "ok", tools: TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return res
      .status(400)
      .json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  const responses = [];
  for (const m of msgs) {
    if (!m || typeof m !== "object" || !m.method) continue;
    if (m.id === undefined) continue; // notification, no response
    responses.push(await handleRpc(m));
  }
  if (!responses.length) return res.status(202).end();
  return res.status(200).json(batch ? responses : responses[0]);
};
