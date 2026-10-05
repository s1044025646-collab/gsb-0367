# 带势并查集差值约束与矛盾链解释后端

纯本地运行的后端服务（TypeScript + Node.js + SQLite），只做 API 与 CLI，无 Docker / WSL / 外部在线依赖。运行时零第三方依赖：HTTP 用 `node:http`，SQLite 用 Node 内置 `node:sqlite`。

## 功能

- 用户声明一批匿名符号（只是变量，不代表真实账户或设备）。
- 按顺序加入关系 `value(B) - value(A) = w`（`w` 为十进制字符串，BigInt 精确计算）。
- 查询两符号相对差值；未连通返回"尚无法确定"而非 0；同一变量到自身恒为 0。
- 新关系判定：`accepted`（连接两个分量）/ `redundant`（一致冗余）/ `rejected`（冲突）。
- 冲突时给出**可核验证据链**：仅由已接受原关系构成的路径，逐边标注方向与带符号差值，其和等于系统已有差值，并给出与新要求的差值 `delta`。
- 冗余关系留审计但不进证据森林；冲突关系记为拒绝，不改变有效约束、不污染后续查询。
- SQLite 持久化关系顺序、接受状态、schema 版本与结果详情；重启后按已接受日志确定性重放重建。
- 修改历史 = 创建新实验；不支持在原结构任意删除。

## 势能符号约定

- `pot[x] = value(x) - value(parent[x])`，根的 `pot` 为 0。
- `find` 沿父链累积势能并路径压缩，压缩后 `pot[x] = value(x) - value(root)`，相对关系不变。
- 合并 `value(b)-value(a)=w`（`ra=find(a)`，`rb=find(b)`，`pa=pot[a]`，`pb=pot[b]`）：
  - `ra` 挂到 `rb` 下：`pot[ra] = pb - pa - w`
  - `rb` 挂到 `ra` 下：`pot[rb] = w + pa - pb`
- 按规模合并；规模相同时**声明顺序编号小者为根**（固定规则，保证重建确定性）。
- 查询 `value(b)-value(a) = pot[b] - pot[a]`（同根时）。
- 加入关系不固定分量绝对基准；根势能 0 只是相对坐标原点选择。

## 限制（可在 `src/service.ts` 的 `DEFAULT_LIMITS` 调整）

| 项 | 默认值 |
|---|---|
| 符号数上限 | 10000 |
| 关系数上限 | 100000 |
| 整数位数上限 | 1000 位十进制 |

## 错误码

`EMPTY_SYMBOL`（空符号）、`UNKNOWN_SYMBOL`（未知符号）、`INVALID_INTEGER`（非法整数字符串）、`LIMIT_EXCEEDED`（超上限）、`EXPERIMENT_NOT_FOUND`、`BAD_REQUEST`、`NOT_FOUND`、`INTERNAL`。冲突/未连通不是传输错误，而是结果中的 `status`/`connected` 字段。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install        # 仅安装 TypeScript 开发依赖
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 内置演示：B-A=5, C-B=-2 => C-A=3；再加 C-A=3（冗余）与 C-A=4（冲突+证据链）
npm start          # 启动 API，默认端口 0 = 自动选空闲端口（PORT 环境变量可指定）
```

## CLI

```powershell
node dist/src/cli.js create demo A,B,C     # 创建符号集（新实验）
node dist/src/cli.js add 1 A B 5           # 加入 value(B)-value(A)=5
node dist/src/cli.js add 1 B C -2
node dist/src/cli.js query 1 A C           # => 3
node dist/src/cli.js add 1 A C 3           # => redundant
node dist/src/cli.js add 1 A C 4           # => rejected + 证据链
node dist/src/cli.js explain 1 A C         # 连接路径（仅已接受原关系）
node dist/src/cli.js node 1 C              # 父节点与势能
node dist/src/cli.js batch 1 items.json    # 批量：[{"a":"A","b":"B","w":"5"},...]
node dist/src/cli.js export 1              # 导出输入与全部关系
node dist/src/cli.js report 1              # 运行报告
node dist/src/cli.js list                  # 列出实验
node dist/src/cli.js serve 8080            # 指定端口启动 API
```

数据目录：项目内 `data/`（可用 `DATA_DIR`、`DB_PATH` 环境变量覆盖）。

**批量提交边界**：先整体校验全部输入格式，任一非法则整体回滚、不留半份状态；合法批次在单个 SQLite 事务中顺序应用并一次提交。批次内某条关系与之前约束冲突时记为 `rejected`（合法输入，正常落库），不影响同批其他关系。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/experiments` | `{name, symbols?}` 创建实验 |
| POST | `/experiments/:id/symbols` | `{symbols:[...]}` 追加符号 |
| POST | `/experiments/:id/relations` | `{a,b,w}` 加入单条关系 |
| POST | `/experiments/:id/relations:batch` | `{items:[{a,b,w}]}` 批量（单事务） |
| GET | `/experiments/:id/query?a=&b=` | 查询差值 |
| GET | `/experiments/:id/explain?a=&b=` | 连接路径解释 |
| GET | `/experiments/:id/nodes/:symbol` | 父节点与势能 |
| GET | `/experiments/:id/export` | 导出 |
| GET | `/experiments/:id/report` | 运行报告 |
| GET | `/health` | 健康检查 |

错误响应：`{"error":{"code","message","details"}}`，HTTP 400（参数类）/ 404 / 500。

## 测试覆盖

`test/run-tests.ts`：正负差值、反向查询、自约束（0 冗余 / 非 0 直接冲突）、不同规模合并方向与 w 符号、路径压缩前后一致性、互不连通分量、大整数、非法输入错误码、批量回滚、重启重建确定性、冲突不污染有效约束，以及对 12 符号 25 条随机关系用**独立图遍历累积边权**作基准核对全部已连通点对的差值与证据路径和。

## 项目结构

```
src/dsu.ts      带势并查集（路径压缩 + 按规模合并 + 固定编号规则）
src/service.ts  校验、错误码、证据森林、冲突解释、重建
src/store.ts    SQLite 持久化（experiments/symbols/relations，WAL，事务）
src/api.ts      HTTP API（node:http，默认空闲端口）
src/cli.ts      命令行入口
src/demo.ts     内置演示
test/run-tests.ts
```
