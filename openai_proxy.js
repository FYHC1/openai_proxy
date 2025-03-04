// 多模型全局配置
const MODEL_CONFIG = {
  openai: {
    apiUrl: "https://api.openai.com/v1",
    authHeader: key => `Bearer ${key}`,
    pathPrefix: "/openai",        // 请求路径前缀
    requiredHeaders: {            // 强制要求的请求头
      "Content-Type": "application/json"
    },
    envKeys: "OPENAI-KEYS"        // 环境变量名
  },
  gemini: {
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    authHeader: key => `Bearer ${key}`,
    pathPrefix: "/gemini",
    requiredHeaders: {
      "Content-Type": "application/json"
      },
    envKeys: "GEMINI-KEYS"
  },
  claude: {
    apiUrl: "https://api.anthropic.com/v1",
    authHeader: key => `x-api-key ${key}`,
    pathPrefix: "/claude",
    requiredHeaders: {
      "Content-Type": "application/json"
    },
    envKeys: "CLAUDE-KEYS"
  }
};

const MAX_RETRIES = 5;      // 最大重试次数
const BASE_DELAY = 1000;    // 基础等待时间（毫秒）

export default {
  async fetch(request, env) {
    try {
      // 解析请求路径确定模型
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const model = pathSegments[0]; // 第一个路径段为模型标识

      // 检查模型是否支持
      const config = MODEL_CONFIG[model];
      if (!config) {
        return new Response(`Unsupported model: ${model}`, { status: 400 });
      }

      // 获取当前模型的API密钥池
      const API_KEYS = env[config.envKeys]?.split(',') || [];
      if (API_KEYS.length === 0) {
        return new Response(`No API keys for ${model}`, { status: 500 });
      }

      // 克隆请求体（用于重试）
      let requestBody = null;
      if (request.method === "POST") {
        requestBody = await request.text();
      }

      // 重试逻辑
      let retryCount = 0;
      while (retryCount <= MAX_RETRIES) {
        try {
          // 轮换 API 密钥
          const apiKey = API_KEYS[retryCount % API_KEYS.length];

          // 构造目标URL
          const targetUrl = new URL(config.apiUrl);
          // 移除模型前缀路径（如 /openai）
          targetUrl.pathname = url.pathname.replace(`/${model}`, '');
          // 保留查询参数
          targetUrl.search = url.search;

          // 设置请求头
          const headers = new Headers(request.headers);
          headers.set("Authorization", config.authHeader(apiKey));
          // 强制覆盖必要请求头
          Object.entries(config.requiredHeaders).forEach(([k, v]) => {
            headers.set(k, v);
          });

          // 创建转发请求
          const modifiedRequest = new Request(targetUrl, {
            method: request.method,
            headers: headers,
            body: requestBody
          });

          // 发送请求
          const response = await fetch(modifiedRequest);

          // 处理 429 错误
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After") || Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            retryCount++;
            continue;
          }

          // 透传响应（支持流式传输）
          return new Response(response.body, {
            status: response.status,
            headers: response.headers
          });

        } catch (error) {
          retryCount++;
          if (retryCount > MAX_RETRIES) break;
          await new Promise(resolve => setTimeout(resolve, BASE_DELAY * retryCount));
        }
      }

      return new Response("Too Many Retries", { status: 429 });

    } catch (e) {
      return new Response(e.stack, { status: 500 });
    }
  },
};