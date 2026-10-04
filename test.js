const handler = require("./api/mcp");

function call(body) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      status(c) { this.code = c; return this; },
      json(o) { resolve(o); },
      end() { resolve({ status: this.code }); },
    };
    handler({ method: "POST", headers: {}, body }, res);
  });
}

(async () => {
  console.log(JSON.stringify(await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })));
  const l = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  console.log(l.result.tools.map((t) => t.name));
  const r = await call({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: {
      name: "find_cheapest_flights",
      arguments: { departure_id: "DEL", arrival_id: "GOI", outbound_date: "2026-11-15", currency: "INR", limit: 3 },
    },
  });
  console.log(r.result.content[0].text.slice(0, 1800));
  const bad = await call({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "find_cheapest_flights", arguments: {} },
  });
  console.log(bad.result.content[0].text);
})();
