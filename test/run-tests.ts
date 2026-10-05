import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { WeightedDSU } from "../src/dsu.js";
import { Store } from "../src/store.js";
import { Service, DEFAULT_LIMITS, ApiError } from "../src/service.js";

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e);
    process.exit(1);
  }
}

function tmpSvc(): { svc: Service; store: Store; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsu-test-"));
  const store = new Store(path.join(dir, "t.db"));
  return { svc: new Service(store, DEFAULT_LIMITS), store, dir };
}

// ---------- DSU 单元 ----------
test("正负差值与反向查询", () => {
  const d = new WeightedDSU();
  ["A", "B", "C"].forEach((s, i) => d.addSymbol(s, i));
  d.union("A", "B", 5n); // B-A=5
  d.union("B", "C", -2n); // C-B=-2
  assert.equal(d.diff("A", "C"), 3n);
  assert.equal(d.diff("C", "A"), -3n);
  assert.equal(d.diff("A", "B"), 5n);
  assert.equal(d.diff("B", "A"), -5n);
  assert.equal(d.diff("A", "A"), 0n);
});

test("未连通返回 null，自身为 0", () => {
  const d = new WeightedDSU();
  d.addSymbol("X", 0);
  d.addSymbol("Y", 1);
  assert.equal(d.diff("X", "Y"), null);
  assert.equal(d.diff("X", "X"), 0n);
});

test("不同规模合并方向与符号正确", () => {
  const d = new WeightedDSU();
  ["r1", "r2", "r3", "s1"].forEach((s, i) => d.addSymbol(s, i));
  d.union("r1", "r2", 10n); // r2-r1=10，分量{r1,r2}
  d.union("r2", "r3", 10n); // 分量{r1,r2,r3}
  d.union("s1", "r3", 7n); // 小分量挂大分量：r3-s1=7
  assert.equal(d.diff("s1", "r1"), -13n); // v(r1)-v(s1) = 7-20
  assert.equal(d.diff("r1", "s1"), 13n);
  // 反向再构造一个，验证 w 符号不随合并方向颠倒
  const d2 = new WeightedDSU();
  ["p", "q"].forEach((s, i) => d2.addSymbol(s, i));
  d2.union("p", "q", -4n); // q-p=-4
  assert.equal(d2.diff("p", "q"), -4n);
  assert.equal(d2.diff("q", "p"), 4n);
});

test("路径压缩前后差值不变", () => {
  const d = new WeightedDSU();
  const names = Array.from({ length: 8 }, (_, i) => `n${i}`);
  names.forEach((s, i) => d.addSymbol(s, i));
  for (let i = 0; i < 7; i++) d.union(names[i], names[i + 1], BigInt(i + 1));
  const before = d.diff("n0", "n7");
  d.find("n7"); // 触发压缩
  const after = d.diff("n0", "n7");
  assert.equal(before, after);
  assert.equal(after, 28n); // 1+2+...+7
  // 压缩后势能仍满足 pot[x]=v(x)-v(parent)
  const raw = d.rawParent("n7");
  assert.equal(
    d.potential("n7"),
    BigInt(raw.potToParent) + (raw.parent === d.find(raw.parent) ? 0n : 0n)
  );
});

test("大整数精确计算", () => {
  const d = new WeightedDSU();
  d.addSymbol("a", 0);
  d.addSymbol("b", 1);
  const big = 123456789012345678901234567890n;
  d.union("a", "b", big);
  assert.equal(d.diff("a", "b"), big);
});

// ---------- 服务层 ----------
test("演示场景：冗余与冲突证据链", () => {
  const { svc, store } = tmpSvc();
  const { id } = svc.createExperiment("t", ["A", "B", "C"]);
  assert.equal(svc.addRelation(id, "A", "B", "5").status, "accepted");
  assert.equal(svc.addRelation(id, "B", "C", "-2").status, "accepted");
  assert.equal(svc.query(id, "A", "C").diff, "3");
  const red = svc.addRelation(id, "A", "C", "3");
  assert.equal(red.status, "redundant");
  const conf = svc.addRelation(id, "A", "C", "4");
  assert.equal(conf.status, "rejected");
  const detail = conf.detail as { existing: string; delta: string; evidence: { signedW: string }[] };
  assert.equal(detail.existing, "3");
  assert.equal(detail.delta, "1");
  const sum = detail.evidence.reduce((a, e) => a + BigInt(e.signedW), 0n);
  assert.equal(sum, 3n);
  // 冲突不污染查询
  assert.equal(svc.query(id, "A", "C").diff, "3");
  // 证据只含已接受原关系（seq 1,2）
  const seqs = (detail.evidence as unknown as { seq: number }[]).map((e) => e.seq).sort();
  assert.deepEqual(seqs, [1, 2]);
  store.close();
});

test("自约束：0 冗余，非 0 直接冲突", () => {
  const { svc, store } = tmpSvc();
  const { id } = svc.createExperiment("t", ["A"]);
  assert.equal(svc.addRelation(id, "A", "A", "0").status, "redundant");
  const r = svc.addRelation(id, "A", "A", "7");
  assert.equal(r.status, "rejected");
  assert.equal((r.detail as { reason: string }).reason, "self_nonzero");
  store.close();
});

test("错误码：空符号/未知符号/非法整数", () => {
  const { svc, store } = tmpSvc();
  const { id } = svc.createExperiment("t", ["A", "B"]);
  assert.throws(() => svc.addRelation(id, "", "B", "1"), (e: ApiError) => e.code === "EMPTY_SYMBOL");
  assert.throws(() => svc.addRelation(id, "ZZ", "B", "1"), (e: ApiError) => e.code === "UNKNOWN_SYMBOL");
  assert.throws(() => svc.addRelation(id, "A", "B", "1.5"), (e: ApiError) => e.code === "INVALID_INTEGER");
  assert.throws(() => svc.addRelation(id, "A", "B", "12a"), (e: ApiError) => e.code === "INVALID_INTEGER");
  store.close();
});

test("批量：非法批次整体回滚，不留半份状态", () => {
  const { svc, store } = tmpSvc();
  const { id } = svc.createExperiment("t", ["A", "B", "C"]);
  assert.throws(
    () => svc.addBatch(id, [{ a: "A", b: "B", w: "5" }, { a: "B", b: "C", w: "bad" }]),
    (e: ApiError) => e.code === "INVALID_INTEGER"
  );
  assert.equal(svc.report(id).total, 0); // 无半份状态
  assert.equal(svc.query(id, "A", "B").connected, false);
  const ok = svc.addBatch(id, [{ a: "A", b: "B", w: "5" }, { a: "B", b: "C", w: "-2" }]);
  assert.equal(ok.count, 2);
  assert.equal(svc.query(id, "A", "C").diff, "3");
  store.close();
});

test("重启重建：按已接受日志重放，结果一致且确定", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsu-test-"));
  const db = path.join(dir, "t.db");
  let store = new Store(db);
  let svc = new Service(store);
  const { id } = svc.createExperiment("t", ["A", "B", "C", "D"]);
  svc.addRelation(id, "A", "B", "5");
  svc.addRelation(id, "B", "C", "-2");
  svc.addRelation(id, "A", "C", "4"); // rejected
  const before = svc.query(id, "A", "C").diff;
  const rootBefore = svc.nodeInfo(id, "C").root;
  store.close();
  // 模拟重启
  store = new Store(db);
  svc = new Service(store);
  assert.equal(svc.query(id, "A", "C").diff, before);
  assert.equal(svc.nodeInfo(id, "C").root, rootBefore); // 代表节点确定性
  assert.equal(svc.query(id, "A", "D").connected, false);
  store.close();
});

test("基准核对：独立图遍历验证全部已连通点对", () => {
  const { svc, store } = tmpSvc();
  const syms = Array.from({ length: 12 }, (_, i) => `s${i}`);
  const { id } = svc.createExperiment("t", syms);
  // 确定性伪随机
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const edges: { a: string; b: string; w: bigint }[] = [];
  for (let i = 0; i < 25; i++) {
    const a = syms[Math.floor(rnd() * syms.length)];
    const b = syms[Math.floor(rnd() * syms.length)];
    const w = BigInt(Math.floor(rnd() * 2001) - 1000);
    if (a === b) continue;
    svc.addRelation(id, a, b, w.toString());
    edges.push({ a, b, w });
  }
  // 基准：只用 accepted 边建图，BFS 累积
  const accepted = svc.export(id).relations.filter((r) => r.status === "accepted");
  const adj = new Map<string, { to: string; w: bigint }[]>();
  for (const e of accepted) {
    const w = BigInt(e.w);
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, w });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, w: -w });
  }
  const val = new Map<string, bigint>();
  for (const s of syms) {
    if (val.has(s) || !adj.has(s)) continue;
    val.set(s, 0n);
    const q = [s];
    while (q.length) {
      const c = q.shift()!;
      for (const e of adj.get(c)!) {
        if (!val.has(e.to)) {
          val.set(e.to, val.get(c)! + e.w);
          q.push(e.to);
        }
      }
    }
  }
  for (const x of syms) {
    for (const y of syms) {
      const q = svc.query(id, x, y);
      const connected = val.has(x) && val.has(y) &&
        (() => { // 同分量判定：从 x BFS 是否到 y
          const seen = new Set([x]); const qq = [x];
          while (qq.length) { const c = qq.shift()!; if (c === y) return true;
            for (const e of adj.get(c) ?? []) if (!seen.has(e.to)) { seen.add(e.to); qq.push(e.to); } }
          return false; })();
      if (!connected) {
        assert.equal(q.connected, false, `${x}->${y} 应不连通`);
      } else {
        assert.equal(q.connected, true);
        assert.equal(q.diff, (val.get(y)! - val.get(x)!).toString(), `${x}->${y} 差值`);
        // explain 路径和等于差值，且只含 accepted
        const ex = svc.explain(id, x, y);
        assert.equal(ex.verified, true);
        assert.equal(ex.sum, q.diff);
      }
    }
  }
  assert.ok(edges.length > 0);
  store.close();
});

test("冲突后有效约束不变", () => {
  const { svc, store } = tmpSvc();
  const { id } = svc.createExperiment("t", ["A", "B", "C"]);
  svc.addRelation(id, "A", "B", "5");
  svc.addRelation(id, "B", "C", "-2");
  const snapBefore = svc.export(id).relations.filter((r) => r.status === "accepted").length;
  svc.addRelation(id, "A", "C", "99"); // rejected
  svc.addRelation(id, "C", "A", "1"); // rejected（反向也冲突）
  const snapAfter = svc.export(id).relations.filter((r) => r.status === "accepted").length;
  assert.equal(snapBefore, snapAfter);
  assert.equal(svc.query(id, "A", "C").diff, "3");
  store.close();
});

console.log(`\n全部通过: ${passed} 个测试`);
