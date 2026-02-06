# LLM 服务迁移指南

## 从智谱 GLM 迁移到豆包（火山引擎）

### 更新内容

已将系统从智谱 GLM-4.7 迁移到豆包（火山引擎 Doubao）API。

### 配置变更

#### 环境变量 (.env)

**旧配置（GLM）：**
```bash
GLM_API_KEY=your-glm-key
GLM_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
GLM_MODEL=glm-4.7
```

**新配置（豆包）：**
```bash
DOUBAO_API_KEY=1168bdb2-8680-45d6-b41f-38a081a670c1
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
DOUBAO_MODEL=doubao-seed-1-6-251015
```

### 代码变更

#### 1. 配置文件 (src/utils/config.ts)

添加了 `config.llm` 配置项，保留 `config.glm` 以向后兼容：

```typescript
export const config = {
  llm: {
    apiKey: getEnv('DOUBAO_API_KEY'),
    apiUrl: getEnv('DOUBAO_API_URL', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'),
    model: getEnv('DOUBAO_MODEL', 'doubao-seed-1-6-251015'),
  },
  // 保留 glm 配置以向后兼容
  glm: {
    apiKey: getEnv('GLM_API_KEY'),
    apiUrl: getEnv('GLM_API_URL', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
    model: getEnv('GLM_MODEL', 'glm-4.7'),
  },
  // ...
};
```

#### 2. LLM 服务 (src/services/LLMService.ts)

- 重命名接口：`GLMMessage` → `LLMMessage`，`GLMResponse` → `LLMResponse`
- 添加豆包 API 特有的 `thinking` 参数支持
- 自动检测 API 提供商并调整日志输出

```typescript
// 检测是否为豆包 API
const isDoubao = this.config.apiUrl.includes('volces.com');

const requestBody: any = {
  model: this.config.model,
  messages,
  temperature: this.config.temperature,
  max_tokens: this.config.maxTokens,
};

// 豆包特有的 thinking 参数
if (isDoubao) {
  requestBody.thinking = {
    type: 'disabled'  // 生成代码时禁用思考模式以提高速度
  };
}
```

#### 3. 命令文件更新

- `src/commands/crawl.ts`: `config.glm` → `config.llm`
- `src/commands/generate.ts`: `config.glm` → `config.llm`

### API 对比

| 特性 | 智谱 GLM | 豆包 Doubao |
|------|---------|------------|
| **API 端点** | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| **认证方式** | `Bearer {API_KEY}` | `Bearer {API_KEY}` |
| **消息格式** | OpenAI 兼容 | OpenAI 兼容 |
| **特有参数** | `thinking: {type: "enabled"}` | `thinking: {type: "disabled"}` |
| **默认模型** | `glm-4.7` | `doubao-seed-1-6-251015` |
| **响应格式** | 标准格式 | 标准格式 |

### 兼容性

LLMService 现在支持：
- ✅ 豆包（Doubao - 火山引擎）
- ✅ 智谱 GLM
- ✅ 其他 OpenAI 兼容的 API

只需修改 `.env` 文件即可切换服务商。

### 测试验证

测试豆包 API 连接：

```bash
curl -X POST 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 1168bdb2-8680-45d6-b41f-38a081a670c1' \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100,
    "thinking": {"type": "disabled"}
  }'
```

### 使用示例

生成解析器：

```bash
npm run generate -- --csv
```

爬取数据：

```bash
npm run crawl -- --csv
```

### 注意事项

1. **API Key 格式不同**：
   - 豆包：UUID 格式（如 `1168bdb2-8680-45d6-b41f-38a081a670c1`）
   - GLM：`{数字ID}.{密钥}` 格式

2. **thinking 参数**：
   - 豆包通常设置为 `"disabled"` 以提高响应速度
   - GLM 可设置为 `"enabled"` 以获得更高质量的输出

3. **计费方式**：
   - 请参考各服务商的定价策略
   - 豆包和 GLM 的 token 定价可能不同

### 回滚到 GLM

如需切换回智谱 GLM，只需修改 `.env` 文件：

```bash
# 注释掉豆包配置
# DOUBAO_API_KEY=...

# 启用 GLM 配置
GLM_API_KEY=your-glm-api-key
GLM_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
GLM_MODEL=glm-4.7
```

然后修改 `src/utils/config.ts` 中的默认值：

```typescript
llm: {
  apiKey: getEnv('GLM_API_KEY'),
  apiUrl: getEnv('GLM_API_URL', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
  model: getEnv('GLM_MODEL', 'glm-4.7'),
},
```

### 状态

✅ 迁移完成
✅ API 测试通过
✅ 向后兼容性保留
