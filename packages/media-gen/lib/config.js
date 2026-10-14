/**
 * 密钥与端点解析。
 *
 * 优先级：显式参数 → 环境变量 → 配置文件（~/.dsh/media-gen.json）。
 * 刻意不复刻 OpenDesign 的 SQLite 配置层 —— 对 DSH 来说环境变量 + 一个
 * 可选 JSON 文件就够了，而且用户能直接看懂、能进 dotfiles。
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_PATH = process.env.DECK_LIBS_MEDIA_CONFIG
  || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'media-gen.json');

export function loadConfigFile() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error(`读取 ${CONFIG_PATH} 失败：${error.message}`);
  }
}

export function configPath() { return CONFIG_PATH; }

/**
 * 解析某个协议族所需的凭据。
 * @param {'fal'|'ark'|'openai'} family
 */
export function resolveCredentials(family, fileCfg = loadConfigFile()) {
  const f = (fileCfg.providers ?? {})[family] ?? {};
  if (family === 'fal') {
    const apiKey = process.env.FAL_KEY || process.env.FAL_API_KEY || f.apiKey;
    return { apiKey, baseUrl: process.env.FAL_BASE_URL || f.baseUrl || 'https://fal.run',
             envHints: ['FAL_KEY', 'FAL_API_KEY'] };
  }
  if (family === 'ark') {
    const apiKey = process.env.ARK_API_KEY || f.apiKey;
    return { apiKey, baseUrl: process.env.ARK_BASE_URL || f.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
             envHints: ['ARK_API_KEY'] };
  }
  if (family === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY || f.apiKey;
    return { apiKey, baseUrl: process.env.OPENAI_BASE_URL || f.baseUrl || 'https://api.openai.com/v1',
             envHints: ['OPENAI_API_KEY'] };
  }
  throw new Error(`未知的协议族：${family}`);
}
