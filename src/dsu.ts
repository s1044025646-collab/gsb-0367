/**
 * 带势（带权）并查集 —— 纯内存数据结构，与存储层无关。
 *
 * 势能符号约定（关键）：
 *   对每个节点 x 保存 potential[x]，满足
 *       value(x) - value(parent[x]) === potential[x]
 *   find(x) 做路径压缩后 parent[x] 指向根 r，此时
 *       value(x) - value(r) === potential[x]
 *   因此对任意两点 a、b（同根时）：
 *       value(b) - value(a) === potential[b] - potential[a]
 *
 * 关系 value(b) - value(a) = w 的合并公式：
 *   ra = find(a)，rb = find(b)，
 *   pa = potential[a] = value(a)-value(ra)，
 *   pb = potential[b] = value(b)-value(rb)。
 *   若把 rb 挂到 ra 下（parent[rb]=ra），设 d = potential[rb] = value(rb)-value(ra)：
 *       w = value(b)-value(a) = (pb + value(rb)) - (pa + value(ra))
 *         = pb - pa + d
 *       => d = w + pa - pb
 *   若把 ra 挂到 rb 下（parent[ra]=rb），设 e = potential[ra] = value(ra)-value(rb) = -d：
 *       e = pa - pb - w
 */

export interface DiffResult {
  connected: boolean;
  /** value(b) - value(a)，仅在 connected 时有效 */
  diff: bigint;
}

export interface NodeView {
  id: number;
  parent: number;
  /** value(id) - value(parent)，父为根时即到根的势能 */
  potential: bigint;
  root: number;
  /** value(id) - value(root) */
  potentialToRoot: bigint;
  size: number;
}

export type MergeOutcome =
  | { kind: 'merged'; rootA: number; rootB: number; attachedRoot: number; newRoot: number }
  | { kind: 'same'; existingDiff: bigint; consistent: boolean };

export class WeightedDSU {
  private parent: number[] = [];
  private pot: bigint[] = [];
  private sizeArr: number[] = [];

  /** 追加一个独立新节点，返回其编号。 */
  addNode(): number {
    const id = this.parent.length;
    this.parent.push(id);
    this.pot.push(0n);
    this.sizeArr.push(1);
    return id;
  }

  get count(): number {
    return this.parent.length;
  }

  /** 迭代式查找根并做路径压缩，返回根与 value(x)-value(root)。 */
  find(x: number): { root: number; potentialToRoot: bigint } {
    if (x < 0 || x >= this.parent.length) throw new Error(`DSU 节点越界: ${x}`);

    // 先沿父指针走到根，记录路径并累加势能。
    const path: number[] = [];
    let cur = x;
    let acc = 0n;
    while (this.parent[cur] !== cur) {
      path.push(cur);
      acc += this.pot[cur];
      cur = this.parent[cur];
    }
    const root = cur;

    // 再算每个节点到根的势能并直接挂到根下（保持相对关系不变）。
    let suffix = acc; // 路径上尚未处理节点到根的势能
    for (const node of path) {
      const edge = this.pot[node];
      const toRoot = suffix;
      this.parent[node] = root;
      this.pot[node] = toRoot;
      suffix -= edge;
    }

    return { root, potentialToRoot: this.parent[x] === root ? this.pot[x] : acc };
  }

  /** 返回 value(b) - value(a)；未连通返回 connected=false。 */
  diff(a: number, b: number): DiffResult {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra.root !== rb.root) return { connected: false, diff: 0n };
    return { connected: true, diff: rb.potentialToRoot - ra.potentialToRoot };
  }

  /**
   * 加入关系 value(b)-value(a)=w。
   * - 不同分量：按规模合并（规模相同取编号较小者为根，保证确定性），返回 merged。
   * - 同一分量：比较已有差值，不做任何修改，返回 same。
   */
  union(a: number, b: number, w: bigint): MergeOutcome {
    const { root: ra, potentialToRoot: pa } = this.find(a);
    const { root: rb, potentialToRoot: pb } = this.find(b);

    if (ra === rb) {
      const existing = pb - pa; // value(b)-value(a)
      return { kind: 'same', existingDiff: existing, consistent: existing === w };
    }

    const sizeA = this.sizeArr[ra];
    const sizeB = this.sizeArr[rb];
    // 规模大的分量做根；规模相同则编号较小者做根（固定规则，可复现）。
    const attachBtoA = sizeA > sizeB || (sizeA === sizeB && ra < rb);

    if (attachBtoA) {
      // parent[rb] = ra，potential[rb] = w + pa - pb
      this.parent[rb] = ra;
      this.pot[rb] = w + pa - pb;
      this.sizeArr[ra] = sizeA + sizeB;
      return { kind: 'merged', rootA: ra, rootB: rb, attachedRoot: rb, newRoot: ra };
    } else {
      // parent[ra] = rb，potential[ra] = pa - pb - w
      this.parent[ra] = rb;
      this.pot[ra] = pa - pb - w;
      this.sizeArr[rb] = sizeA + sizeB;
      return { kind: 'merged', rootA: ra, rootB: rb, attachedRoot: ra, newRoot: rb };
    }
  }

  /** 查看节点原始父边与规范化视图（find 会触发压缩，故先读快照再 find）。 */
  view(x: number): NodeView {
    const parent = this.parent[x];
    const potential = this.pot[x];
    const { root, potentialToRoot } = this.find(x);
    return { id: x, parent, potential, root, potentialToRoot, size: this.sizeArr[x] };
  }

  /** 全量快照（不触发压缩）：用于诊断/导出。 */
  snapshot(): Array<{ id: number; parent: number; potential: bigint; size: number }> {
    return this.parent.map((parent, id) => ({
      id,
      parent,
      potential: this.pot[id],
      size: this.sizeArr[id],
    }));
  }
}
