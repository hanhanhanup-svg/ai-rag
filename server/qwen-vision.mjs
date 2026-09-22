/**
 * DashScope / 通义千问视觉识别：用于扫描件、图片与视频抽帧的正文提取。
 * 失败时由调用方回退本地 OCR，不抛出业务中断。
 * 视觉路由与聊天默认模型解耦：主配置可为 DeepSeek，OCR 仍走 DashScope。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chatProviderCredentials, modelConfig } from './retrieval.mjs';

const DEFAULT_VISION_MODEL = 'qwen3-vl-plus';
const QWEN_VISION_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function visionModelName(store) {
  const saved = store?.get?.('setting', 'model') || {};
  return (process.env.AI_VISION_MODEL || saved.visionModel || DEFAULT_VISION_MODEL).trim() || DEFAULT_VISION_MODEL;
}

/** Resolve DashScope endpoint + key for vision OCR (independent of chat default). */
export function visionRoute(store) {
  const { qwen } = chatProviderCredentials(store);
  const envKey = (process.env.DASHSCOPE_API_KEY || process.env.AI_API_KEY || '').trim();
  const apiKey = (qwen.apiKey || envKey).trim();
  if (!apiKey) return null;
  let baseUrl = QWEN_VISION_BASE_URL;
  try {
    const host = new URL(qwen.baseUrl || '').hostname.toLowerCase();
    if (host.includes('dashscope') || host.includes('aliyuncs')) baseUrl = qwen.baseUrl.replace(/\/$/, '');
  } catch { /* keep default DashScope URL */ }
  return { baseUrl, apiKey, provider: qwen.provider || 'compatible' };
}

export function qwenVisionEnabled(store) {
  if (process.env.PARSE_USE_QWEN === 'false') return false;
  const config = modelConfig(store);
  if (config.provider === 'disabled') return false;
  return Boolean(visionRoute(store)?.apiKey);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.tif': 'image/tiff', '.tiff': 'image/tiff' })[ext] || 'image/png';
}

/**
 * @returns {Promise<{text:string,model:string,method:string}|null>}
 */
export async function tryQwenVisionOcr(filePath, store, { feature = 'parse_vision', signal } = {}) {
  if (!store || !qwenVisionEnabled(store)) return null;
  const route = visionRoute(store);
  if (!route) return null;
  const config = modelConfig(store);
  const model = visionModelName(store);
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const dataUrl = `data:${mimeFor(filePath)};base64,${bytes.toString('base64')}`;
  const body = {
    model,
    temperature: 0,
    max_tokens: 1800,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请完整识别图片中的全部可见文字（含表格、标题、手写若可辨认）。只输出识别出的正文，保持大致阅读顺序；不要解释、不要总结、不要添加未出现在图中的内容。若几乎没有文字，输出空字符串。',
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  };
  const timeoutMs = Math.min(120000, Math.max(20000, Number(config.timeoutMs) || 90000));
  try {
    const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${route.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const result = await response.json();
    const text = String(result?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { text: '', model, method: 'qwen-vl' };
    return { text, model, method: 'qwen-vl', feature };
  } catch {
    return null;
  }
}
