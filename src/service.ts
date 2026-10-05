import { WeightedDSU } from "./dsu.js";
import { Store } from "./store.js";

/** 稳定错误码 */
export const ERR = {
  EMPTY_SYMBOL: "EMPTY_SYMBOL",
  UNKNOWN_SYMBOL: "UNKNOWN_SYMBOL",
  INVALID_INTEGER: "INVALID_INTEGER",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  CONFLICT: "CONFLICT",
  NOT_CONNECTED: "NOT_CONNECTED",
  EXPERIMENT_NOT_FOUND: "EXPERIMENT_NOT_FOUND",
  BAD_REQUEST: "BAD_REQUEST",
} as const;

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Limits {
  maxSymbols: number;
  maxRelations: number;
  maxIntDigits: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSymbols: 10000,
  maxRelations: 100000,
  maxIntDigits: 1000,
};

export interface EvidenceEdge {
  seq: number; // 已接受原关系的序号
  from: string;
  to: string;
  /** 沿 from->to 方向的带符号差值：value(to)-value(from) */
  signedW: string;
}

interface ForestEdge {
  seq: number;
  a: string;
  b: string;
  w: bigint; // value(b)-value(a)
}

export function parseIntStrict(raw: unknown, limits: Limits): bigint {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "bigint") {
    throw new ApiError(ERR.INVALID_INTEGER, `整数必须是十进制字符串，收到: ${typeof raw}`);
  }
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) {
    throw new ApiError(ERR.INVALID_INTEGER, `非法整数字符串: "${s}"`);
  }
  const digits = s.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  if (digits.length > limits.maxIntDigits) {
    throw new ApiError(ERR.LIMIT_EXCEEDED, `整数位数 ${digits.length} 超过上限 ${limits.maxIntDigits}`);
  }
  return BigInt(s);
}

export function checkSymbol(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ApiError(ERR.EMPTY_SYMBOL, "符号不能为空");
  }
  return raw.trim();
}

/** 单个实验：DSU + 证据森林（仅含 accepted 原关系）。 */
export class Experiment {
  dsu = new WeightedDSU();
  forest: ForestEdge[] = [];
  seq = 0;

  constructor(
    public id: number,
    public limits: Limits
  ) {}

  addSymbolChecked(raw: unknown): string {
    const s = checkSymbol(raw);
    if (!this.dsu.has(s)) {
      if (this.dsu.symbols().length >= this.limits.maxSymbols) {
        throw new ApiError(ERR.LIMIT_EXCEEDED, `符号数超过上限 ${this.limits.maxSymbols}`);
      }
      this.dsu.addSymbol(s, this.dsu.symbols().length);
    }
    return s;
  }

  /** 核心：尝试加入 value(b)-value(a)=w。返回状态与详情，不写库。 */
  applyRelation(a: string, b: string, w: bigint): {
    status: "accepted" | "redundant" | "rejected";
    detail: Record<string, unknown>;
  } {
    this.seq += 1;
    if (!this.dsu.has(a)) throw new ApiError(ERR.UNKNOWN_SYMBOL, `未知符号: ${a}`);
    if (!this.dsu.has(b)) throw new ApiError(ERR.UNKNOWN_SYMBOL, `未知符号: ${b}`);
    if (this.seq > this.limits.maxRelations) {
      throw new ApiError(ERR.LIMIT_EXCEEDED, `关系数超过上限 ${this.limits.maxRelations}`);
    }
    if (a === b) {
      if (w === 0n) {
        return { status: "redundant", detail: { reason: "self_zero", existing: "0" } };
      }
      return {
        status: "rejected",
        detail: {
          reason: "self_nonzero",
          message: `自身差值恒为 0，要求 value(${a})-value(${a})=${w} 直接冲突`,
          evidence: [],
          existing: "0",
          requested: w.toString(),
          delta: w.toString(),
        },
      };
    }
    const existing = this.dsu.diff(a, b);
    if (existing === null) {
      this.dsu.union(a, b, w);
      this.forest.push({ seq: this.seq, a, b, w });
      return { status: "accepted", detail: { seq: this.seq } };
    }
    if (existing === w) {
      return {
        status: "redundant",
        detail: { reason: "consistent", existing: existing.toString(), requested: w.toString() },
      };
    }
    const evidence = this.findPath(a, b);
    return {
      status: "rejected",
      detail: {
        reason: "conflict",
        existing: existing.toString(),
        requested: w.toString(),
        delta: (w - existing).toString(),
        evidence,
        message: `已有约束推出 value(${b})-value(${a})=${existing}，与新要求 ${w} 相差 ${w - existing}`,
      },
    };
  }

  /** 在证据森林（仅 accepted 原关系）中找 a->b 路径，返回逐边带符号差值。 */
  findPath(a: string, b: string): EvidenceEdge[] {
    const adj = new Map<string, { to: string; seq: number; signed: bigint }[]>();
    for (const e of this.forest) {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a)!.push({ to: e.b, seq: e.seq, signed: e.w });
      adj.get(e.b)!.push({ to: e.a, seq: e.seq, signed: -e.w });
    }
    // BFS
    const prev = new Map<string, { from: string; seq: number; signed: bigint }>();
    const queue = [a];
    const seen = new Set([a]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === b) break;
      for (const e of adj.get(cur) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          prev.set(e.to, { from: cur, seq: e.seq, signed: e.signed });
          queue.push(e.to);
        }
      }
    }
    if (!prev.has(b) && a !== b) return [];
    const path: EvidenceEdge[] = [];
    let cur = b;
    while (cur !== a) {
      const p = prev.get(cur)!;
      path.push({ seq: p.seq, from: p.from, to: cur, signedW: p.signed.toString() });
      cur = p.from;
    }
    return path.reverse();
  }
}

/** 服务层：管理实验、持久化、重建。 */
export class Service {
  private cache = new Map<number, Experiment>();

  constructor(public store: Store, public limits: Limits = DEFAULT_LIMITS) {}

  createExperiment(name: string, symbols: string[] = []): { id: number; symbols: string[] } {
    const clean = symbols.map(checkSymbol);
    const id = this.store.tx(() => {
      const eid = this.store.createExperiment(name);
      const exp = new Experiment(eid, this.limits);
      for (const s of clean) {
        exp.addSymbolChecked(s);
      }
      exp.dsu.symbols().forEach((s, i) => this.store.addSymbol(eid, s, i));
      return eid;
    });
    this.cache.delete(id);
    return { id, symbols: this.store.symbols(id).map((r) => r.name) };
  }

  /** 从已接受日志重建（确定性：按 seq 顺序重放，符号按 ord 固定编号）。 */
  load(expId: number): Experiment {
    const hit = this.cache.get(expId);
    if (hit) return hit;
    const syms = this.store.symbols(expId);
    if (syms.length === 0) {
      const exps = this.store.experiments();
      if (!exps.some((e) => e.id === expId)) {
        throw new ApiError(ERR.EXPERIMENT_NOT_FOUND, `实验 ${expId} 不存在`);
      }
    }
    const exp = new Experiment(expId, this.limits);
    for (const s of syms) exp.dsu.addSymbol(s.name, s.ord);
    for (const r of this.store.relations(expId)) {
      exp.seq = r.seq;
      if (r.status === "accepted") {
        const w = BigInt(r.w);
        exp.dsu.union(r.a, r.b, w);
        exp.forest.push({ seq: r.seq, a: r.a, b: r.b, w });
      }
    }
    this.cache.set(expId, exp);
    return exp;
  }

  addSymbols(expId: number, rawSymbols: unknown[]): { id: number; added: string[] } {
    if (!Array.isArray(rawSymbols)) throw new ApiError(ERR.BAD_REQUEST, "symbols 必须是数组");
    const exp = this.load(expId);
    const added: string[] = [];
    this.store.tx(() => {
      for (const raw of rawSymbols) {
        const s = exp.addSymbolChecked(raw);
        if (!this.store.symbols(expId).some((r) => r.name === s)) {
          this.store.addSymbol(expId, s, this.store.symbols(expId).length);
          added.push(s);
        }
      }
    });
    return { id: expId, added };
  }

  addRelation(expId: number, rawA: unknown, rawB: unknown, rawW: unknown, batchId: string | null = null) {
    const a = checkSymbol(rawA);
    const b = checkSymbol(rawB);
    const w = parseIntStrict(rawW, this.limits);
    const exp = this.load(expId);
    const result = exp.applyRelation(a, b, w);
    this.store.insertRelation({
      experiment_id: expId,
      seq: exp.seq,
      a, b,
      w: w.toString(),
      status: result.status,
      detail: JSON.stringify(result.detail),
      batch_id: batchId,
    });
    return { seq: exp.seq, a, b, w: w.toString(), ...result };
  }

  /** 批量：先整体校验输入格式（任一非法则整体回滚），再顺序应用；单事务提交。 */
  addBatch(expId: number, items: { a: unknown; b: unknown; w: unknown }[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError(ERR.BAD_REQUEST, "批量内容必须是非空数组");
    }
    const parsed = items.map((it, i) => {
      try {
        return { a: checkSymbol(it.a), b: checkSymbol(it.b), w: parseIntStrict(it.w, this.limits) };
      } catch (e) {
        if (e instanceof ApiError) {
          throw new ApiError(e.code, `批次第 ${i} 项无效: ${e.message}`, { index: i });
        }
        throw e;
      }
    });
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const results = this.store.tx(() =>
      parsed.map((p) => this.addRelation(expId, p.a, p.b, p.w.toString(), batchId))
    );
    return { batchId, count: results.length, results };
  }

  query(expId: number, rawA: unknown, rawB: unknown) {
    const a = checkSymbol(rawA);
    const b = checkSymbol(rawB);
    const exp = this.load(expId);
    for (const s of [a, b]) {
      if (!exp.dsu.has(s)) throw new ApiError(ERR.UNKNOWN_SYMBOL, `未知符号: ${s}`);
    }
    if (a === b) return { a, b, connected: true, diff: "0", note: "同一变量到自身差值恒为 0" };
    const d = exp.dsu.diff(a, b);
    if (d === null) {
      return { a, b, connected: false, diff: null, note: "尚无法确定（两符号未连通）" };
    }
    return {
      a, b, connected: true, diff: d.toString(),
      note: "相对差值；根的绝对基准只是相对坐标选择，不代表真实绝对值",
    };
  }

  explain(expId: number, rawA: unknown, rawB: unknown) {
    const a = checkSymbol(rawA);
    const b = checkSymbol(rawB);
    const exp = this.load(expId);
    for (const s of [a, b]) {
      if (!exp.dsu.has(s)) throw new ApiError(ERR.UNKNOWN_SYMBOL, `未知符号: ${s}`);
    }
    const d = exp.dsu.diff(a, b);
    if (d === null) return { a, b, connected: false, path: [], sum: null };
    const path = exp.findPath(a, b);
    const sum = path.reduce((acc, e) => acc + BigInt(e.signedW), 0n);
    return {
      a, b, connected: true, path, sum: sum.toString(), diff: d.toString(),
      verified: sum === d,
      note: "路径仅由已接受的原关系构成；路径压缩产生的父边不作为证据",
    };
  }

  nodeInfo(expId: number, rawS: unknown) {
    const s = checkSymbol(rawS);
    const exp = this.load(expId);
    if (!exp.dsu.has(s)) throw new ApiError(ERR.UNKNOWN_SYMBOL, `未知符号: ${s}`);
    const root = exp.dsu.find(s);
    const raw = exp.dsu.rawParent(s);
    return {
      symbol: s, root,
      parent: raw.parent,
      potToParent: raw.potToParent,
      potToRoot: exp.dsu.potential(s).toString(),
      note: "pot[x] = value(x) - value(parent(x))；根的势能为 0，只是相对坐标原点",
    };
  }

  export(expId: number) {
    const exp = this.load(expId);
    return {
      experiment: expId,
      schemaVersion: 1,
      limits: this.limits,
      symbols: this.store.symbols(expId).map((r) => r.name),
      relations: this.store.relations(expId).map((r) => ({
        seq: r.seq, a: r.a, b: r.b, w: r.w, status: r.status,
        detail: JSON.parse(r.detail), batchId: r.batch_id, createdAt: r.created_at,
      })),
    };
  }

  report(expId: number) {
    const rels = this.store.relations(expId);
    const count = (st: string) => rels.filter((r) => r.status === st).length;
    return {
      experiment: expId,
      total: rels.length,
      accepted: count("accepted"),
      redundant: count("redundant"),
      rejected: count("rejected"),
      symbols: this.store.symbols(expId).length,
      limits: this.limits,
      schemaVersion: 1,
    };
  }
}
