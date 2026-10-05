import * as path from "node:path";
import { Store } from "./store.js";
import { Service, DEFAULT_LIMITS, ApiError } from "./service.js";
import { startServer } from "./api.js";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "diff.db");

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function usage(): void {
  console.log(`用法: node dist/src/cli.js <命令> [参数]
命令:
  create <name> [sym1,sym2,...]     创建符号集（新实验）
  symbols <expId> <sym1,sym2,...>   追加符号
  add <expId> <A> <B> <w>           加入关系 value(B)-value(A)=w
  batch <expId> <file.json>         批量加入 [{a,b,w},...]（单事务，非法整体回滚）
  query <expId> <A> <B>             查询 value(B)-value(A)
  explain <expId> <A> <B>           查看连接路径（仅已接受原关系）
  node <expId> <S>                  查看父节点与势能
  export <expId>                    导出输入与全部关系
  report <expId>                    运行报告
  list                              列出实验
  serve [port]                      启动 API（默认端口 0=自动选空闲端口）
  demo                              运行内置演示
环境变量: DATA_DIR, DB_PATH, PORT`);
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help") return usage();

  if (cmd === "demo") {
    const { runDemo } = await import("./demo.js");
    return runDemo();
  }

  const store = new Store(DB_PATH);
  const svc = new Service(store, DEFAULT_LIMITS);
  try {
    switch (cmd) {
      case "create": {
        const [name, syms] = args;
        if (!name) throw new ApiError("BAD_REQUEST", "缺少实验名");
        print(svc.createExperiment(name, syms ? syms.split(",") : []));
        break;
      }
      case "symbols": {
        const [id, syms] = args;
        print(svc.addSymbols(Number(id), syms.split(",")));
        break;
      }
      case "add": {
        const [id, a, b, w] = args;
        print(svc.addRelation(Number(id), a, b, w));
        break;
      }
      case "batch": {
        const [id, file] = args;
        const items = JSON.parse((await import("node:fs")).readFileSync(file, "utf8"));
        print(svc.addBatch(Number(id), items));
        break;
      }
      case "query": {
        const [id, a, b] = args;
        print(svc.query(Number(id), a, b));
        break;
      }
      case "explain": {
        const [id, a, b] = args;
        print(svc.explain(Number(id), a, b));
        break;
      }
      case "node": {
        const [id, s] = args;
        print(svc.nodeInfo(Number(id), s));
        break;
      }
      case "export": print(svc.export(Number(args[0]))); break;
      case "report": print(svc.report(Number(args[0]))); break;
      case "list": print(store.experiments()); break;
      case "serve": {
        await startServer(svc, args[0] ? Number(args[0]) : Number(process.env.PORT ?? 0));
        return; // 保持进程
      }
      default:
        usage();
        process.exitCode = 2;
    }
  } catch (e) {
    if (e instanceof ApiError) {
      print({ error: { code: e.code, message: e.message, details: e.details ?? null } });
      process.exitCode = 1;
    } else throw e;
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
