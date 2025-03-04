const MODEL_CONFIG = {
  openai: {
    apiUrl: "https://api.openai.com/v1",
    authType: "header",                  // 认证方式：请求头
    authHeader: key => `Bearer ${key}`,  // 请求头生成规则
    pathPrefix: "/openai",
    requiredHeaders: {
      "Content-Type": "application/json"
    },
    envKeys: "OPENAI_KEYS"
  },
  gemini: {
    apiUrl: "https://api.gemini.com/v1",
    authType: "query",                   // 认证方式：URL 参数
    keyParam: "key",                     // URL 参数名
    pathPrefix: "/gemini",
    requiredHeaders: {},
    envKeys: "GEMINI_KEYS"
  },
  claude: {
    apiUrl: "https://api.anthropic.com/v1",
    authType: "header",
    authHeader: key => `x-api-key ${key}`,
    pathPrefix: "/claude",
    requiredHeaders: {
      "Content-Type": "application/json"
    },
    envKeys: "CLAUDE_KEYS"
  }
};

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathSegments = url.pathname.split('/').filter(Boolean);
      const model = pathSegments[0];

      // 检查模型是否支持
      const config = MODEL_CONFIG[model];
      if (!config) {
        return new Response(`Unsupported model: ${model}`, { status: 400 });
      }

      // 获取当前模型的 API 密钥池
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
          retryCount++;

          // 构造目标 URL
          const targetUrl = new URL(config.apiUrl);
          targetUrl.pathname = url.pathname.replace(`/${model}`, '');
          targetUrl.search = url.search;

          // 根据认证类型处理密钥
          if (config.authType === "header") {
            // 通过请求头认证（OpenAI/Claude）
            const headers = new Headers(request.headers);
            headers.set("Authorization", config.authHeader(apiKey));
            Object.entries(config.requiredHeaders).forEach(([k, v]) => {
              headers.set(k, v);
            });
            var modifiedHeaders = headers;
          } else if (config.authType === "query") {
            // 通过 URL 参数认证（Gemini）
            targetUrl.searchParams.set(config.keyParam, apiKey);
            var modifiedHeaders = new Headers(request.headers);
          }

          // 创建转发请求
          const modifiedRequest = new Request(targetUrl, {
            method: request.method,
            headers: modifiedHeaders,
            body: requestBody
          });

          // 发送请求
          const response = await fetch(modifiedRequest);

          // 处理 429 错误
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After") || Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
          }

          return new Response(response.body, {
            status: response.status,
            headers: response.headers
          });

        } catch (error) {
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