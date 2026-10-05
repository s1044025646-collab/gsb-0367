/** 带势并查集（精确整数差值约束）。
 * 约定：pot[x] = value(x) - value(parent[x])，根节点的 pot 为 0。
 * find 时沿父链累积势能并做路径压缩，压缩后 pot[x] = value(x) - value(root)。
 * 约束语义：value(B) - value(A) = w。
 */
export class WeightedDSU {
  private parent = new Map<string, string>();
  private pot = new Map<string, bigint>();
  private size = new Map<string, number>();
  private order = new Map<string, number>(); // 固定编号，用于同规模合并的确定性规则

  addSymbol(s: string, ord: number): void {
    if (this.parent.has(s)) return;
    this.parent.set(s, s);
    this.pot.set(s, 0n);
    this.size.set(s, 1);
    this.order.set(s, ord);
  }

  has(s: string): boolean {
    return this.parent.has(s);
  }

  /** 返回根，并做路径压缩。 */
  find(s: string): string {
    const p = this.parent.get(s);
    if (p === undefined) throw new Error(`unknown symbol: ${s}`);
    if (p === s) return s;
    const root = this.find(p);
    // 压缩前 pot[s]=v(s)-v(p)，压缩后父链已把 pot[p] 变为 v(p)-v(root)
    this.pot.set(s, this.pot.get(s)! + this.pot.get(p)!);
    this.parent.set(s, root);
    return root;
  }

  /** value(s) - value(root(s))；调用后完成压缩。 */
  potential(s: string): bigint {
    this.find(s);
    return this.pot.get(s)!;
  }

  /** 若连通，返回 value(b) - value(a)；否则 null。 */
  diff(a: string, b: string): bigint | null {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) return null;
    return this.potential(b) - this.potential(a);
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  /** 合并：施加 value(b) - value(a) = w。调用前必须确认不连通。
   * 按规模合并；规模相同时固定编号较小者（声明顺序靠前）为根。 */
  union(a: string, b: string, w: bigint): void {
    let ra = this.find(a);
    let rb = this.find(b);
    const pa = this.potential(a); // v(a)-v(ra)
    const pb = this.potential(b); // v(b)-v(rb)
    const sa = this.size.get(ra)!;
    const sb = this.size.get(rb)!;
    // 决定谁挂在谁下面：规模小者挂大者；相等时编号小者为根
    const aBecomesChild =
      sa < sb || (sa === sb && this.order.get(ra)! > this.order.get(rb)!);
    if (aBecomesChild) {
      // parent[ra]=rb：v(ra)-v(rb) = (v(b)-pb) ... 由 v(b)-v(a)=w 推：
      // v(ra) = v(a)-pa，v(rb)=v(b)-pb，故 v(ra)-v(rb) = v(a)-v(b) - pa + pb = pb - pa - w
      this.parent.set(ra, rb);
      this.pot.set(ra, pb - pa - w);
      this.size.set(rb, sa + sb);
    } else {
      // parent[rb]=ra：v(rb)-v(ra) = v(b)-v(a) - pb + pa = w + pa - pb
      this.parent.set(rb, ra);
      this.pot.set(rb, w + pa - pb);
      this.size.set(ra, sa + sb);
    }
  }

  /** 调试/检查用：直接父节点与到父节点的势能（不触发压缩的语义保证由调用方注意）。 */
  rawParent(s: string): { parent: string; potToParent: string } {
    return { parent: this.parent.get(s)!, potToParent: this.pot.get(s)!.toString() };
  }

  symbols(): string[] {
    return [...this.parent.keys()];
  }
}
