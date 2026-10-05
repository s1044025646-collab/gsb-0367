import * as http from "node:http";
import { Service, ApiError, ERR } from "./service.js";

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(ERR.BAD_REQUEST, "请求体必须是合法 JSON");
  }
}

export function createServer(service: Service): http.Server {
  return http.createServer(async (req, res) => {
    const send = (code: number, obj: unknown) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
      res.end(body);
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const body = method === "POST" ? await readBody(req) : {};

      // POST /experiments {name, symbols?}
      if (method === "POST" && parts.length === 1 && parts[0] === "experiments") {
        const b = body as { name?: string; symbols?: string[] };
        return send(201, service.createExperiment(b.name ?? "experiment", b.symbols ?? []));
      }
      if (parts[0] === "experiments" && parts.length >= 2) {
        const expId = Number(parts[1]);
        if (!Number.isInteger(expId)) throw new ApiError(ERR.BAD_REQUEST, "实验 id 非法");
        const rest = parts.slice(2).join("/");
        // POST /experiments/:id/symbols {symbols:[...]}
        if (method === "POST" && rest === "symbols") {
          return send(200, service.addSymbols(expId, (body as { symbols: unknown[] }).symbols));
        }
        // POST /experiments/:id/relations {a,b,w}
        if (method === "POST" && rest === "relations") {
          const b = body as { a: unknown; b: unknown; w: unknown };
          return send(200, service.addRelation(expId, b.a, b.b, b.w));
        }
        // POST /experiments/:id/relations:batch {items:[{a,b,w}]}
        if (method === "POST" && rest === "relations:batch") {
          return send(200, service.addBatch(expId, (body as { items: never[] }).items));
        }
        // GET /experiments/:id/query?a=&b=
        if (method === "GET" && rest === "query") {
          return send(200, service.query(expId, url.searchParams.get("a"), url.searchParams.get("b")));
        }
        // GET /experiments/:id/explain?a=&b=
        if (method === "GET" && rest === "explain") {
          return send(200, service.explain(expId, url.searchParams.get("a"), url.searchParams.get("b")));
        }
        // GET /experiments/:id/nodes/:symbol
        if (method === "GET" && parts[2] === "nodes" && parts.length === 4) {
          return send(200, service.nodeInfo(expId, decodeURIComponent(parts[3])));
        }
        if (method === "GET" && rest === "export") return send(200, service.export(expId));
        if (method === "GET" && rest === "report") return send(200, service.report(expId));
      }
      if (method === "GET" && url.pathname === "/health") return send(200, { ok: true });
      send(404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
    } catch (e) {
      if (e instanceof ApiError) {
        send(400, { error: { code: e.code, message: e.message, details: e.details ?? null } });
      } else {
        send(500, { error: { code: "INTERNAL", message: String(e) } });
      }
    }
  });
}

/** 默认端口 0 = 让系统分配空闲端口；可用 PORT 环境变量或参数指定。 */
export function startServer(service: Service, port = Number(process.env.PORT ?? 0)): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(service);
    server.listen(port, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      console.log(`API 服务已启动: http://127.0.0.1:${p}`);
      resolve(p);
    });
  });
}
