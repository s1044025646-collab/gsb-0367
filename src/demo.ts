import * as path from "node:path";
import * as fs from "node:fs";
import { Store } from "./store.js";
import { Service, DEFAULT_LIMITS } from "./service.js";

/** 演示：B-A=5, C-B=-2 => C-A=3；再加 C-A=3（冗余）与 C-A=4（冲突+证据链）。 */
export function runDemo(): void {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "demo.db");
  fs.rmSync(dbPath, { force: true });
  const store = new Store(dbPath);
  const svc = new Service(store, DEFAULT_LIMITS);

  const show = (title: string, obj: unknown) => {
    console.log(`\n=== ${title} ===`);
    console.log(JSON.stringify(obj, null, 2));
  };

  const { id } = svc.createExperiment("demo", ["A", "B", "C"]);
  show("创建符号集 A,B,C", { id });

  show("加入 B-A=5", svc.addRelation(id, "A", "B", "5"));
  show("加入 C-B=-2", svc.addRelation(id, "B", "C", "-2"));
  show("查询 C-A（应为 3）", svc.query(id, "A", "C"));
  show("反向查询 A-C（应为 -3）", svc.query(id, "C", "A"));
  show("加入 C-A=3（冗余一致）", svc.addRelation(id, "A", "C", "3"));
  show("加入 C-A=4（冲突，含证据链）", svc.addRelation(id, "A", "C", "4"));
  show("冲突后查询 C-A（仍为 3，未被污染）", svc.query(id, "A", "C"));
  show("解释 A->C 连接路径", svc.explain(id, "A", "C"));
  show("节点 C 的父节点与势能", svc.nodeInfo(id, "C"));
  show("运行报告", svc.report(id));
  store.close();
}

if (process.argv[1] && process.argv[1].endsWith("demo.js")) {
  runDemo();
}
