import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const file = resolve(root, 'local-data', 'ai-settings.json');
export const builtinProfiles = [
  { id: 'breakdown-standard', action: 'breakdown', title: '标准结构', instruction: '先提炼全片共通设定，再按时间顺序拆成少量清楚的镜头。每镜头写主体、动作、场景和必要的摄影信息。' },
  { id: 'breakdown-director', action: 'breakdown', title: '分镜导演', instruction: '强调镜头之间的空间关系、动作连续性、景别变化、运镜起止点和声音衔接。避免一个镜头承载过多事件。' },
  { id: 'breakdown-product', action: 'breakdown', title: '产品广告', instruction: '突出产品外观锚点、使用动作、材质细节与最终英雄镜头。不要编造未经提供的产品功效或品牌主张。' },
  { id: 'optimize-clear', action: 'optimize', title: '清晰精简', instruction: '删去重复与空泛形容词，保留主体、事件、镜头顺序、时间和明确约束。使用具体可观察的表达。' },
  { id: 'optimize-continuity', action: 'optimize', title: '镜头连续性', instruction: '重点检查人物身份、道具位置、运动方向、光线和转场是否在相邻镜头间连续，修复冲突但不增加情节。' },
  { id: 'optimize-constraints', action: 'optimize', title: '约束校对', instruction: '核对时长、画幅、参考素材用途、口型、字幕、声音和禁止项，明确全片约束与逐镜头描述的作用范围。' }
];
const defaults = () => ({ baseUrl: process.env.AI_BASE_URL || '', model: process.env.AI_MODEL || '', apiKey: process.env.AI_API_KEY || '', customProfiles: [], active: { breakdown: 'breakdown-standard', optimize: 'optimize-clear' } });
let settings = defaults();
export async function loadAISettings() {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    settings = { ...defaults(), ...saved, active: { ...defaults().active, ...(saved.active || {}) }, customProfiles: Array.isArray(saved.customProfiles) ? saved.customProfiles : [] };
  } catch { settings = defaults(); }
  return settings;
}
export const aiSettings = () => settings;
export const aiConfigured = () => Boolean(settings.baseUrl && settings.model && settings.apiKey);
export const publicAISettings = () => ({ configured: aiConfigured(), baseUrl: settings.baseUrl, model: settings.model, keySaved: Boolean(settings.apiKey), keyHint: settings.apiKey ? `••••${settings.apiKey.slice(-4)}` : '', active: settings.active, profiles: [...builtinProfiles.map(p => ({ ...p, builtin: true })), ...settings.customProfiles.map(p => ({ ...p, builtin: false }))] });
async function persist() {
  await mkdir(resolve(root, 'local-data'), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}
export async function updateAISettings(input) {
  if (!input || typeof input !== 'object') throw Error('设置格式不正确');
  const next = { ...settings, active: { ...settings.active }, customProfiles: [...settings.customProfiles] };
  if ('baseUrl' in input) {
    if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 500) throw Error('接口地址无效');
    const value = input.baseUrl.trim().replace(/\/$/, '');
    if (value && !/^https?:\/\//i.test(value)) throw Error('接口地址需以 http:// 或 https:// 开头');
    next.baseUrl = value;
  }
  if ('model' in input) {
    if (typeof input.model !== 'string' || input.model.length > 150) throw Error('模型名称无效');
    next.model = input.model.trim();
  }
  if ('apiKey' in input) {
    if (typeof input.apiKey !== 'string' || input.apiKey.length > 1000) throw Error('密钥无效');
    if (input.apiKey.trim()) next.apiKey = input.apiKey.trim();
  }
  if (input.clearKey === true) next.apiKey = '';
  if ('customProfiles' in input) {
    if (!Array.isArray(input.customProfiles) || input.customProfiles.length > 30 || !input.customProfiles.every(p => p && typeof p.id === 'string' && /^custom-[a-zA-Z0-9-]{1,50}$/.test(p.id) && ['breakdown', 'optimize'].includes(p.action) && typeof p.title === 'string' && p.title.trim().length > 0 && p.title.length <= 60 && typeof p.instruction === 'string' && p.instruction.trim().length > 0 && p.instruction.length <= 6000)) throw Error('自定义规则格式不正确');
    if (new Set(input.customProfiles.map(p => p.id)).size !== input.customProfiles.length) throw Error('规则 ID 重复');
    next.customProfiles = input.customProfiles.map(p => ({ id: p.id, action: p.action, title: p.title.trim(), instruction: p.instruction.trim() }));
  }
  if ('active' in input) {
    for (const action of ['breakdown', 'optimize']) if (input.active?.[action]) {
      const id = input.active[action];
      if (![...builtinProfiles, ...next.customProfiles].some(p => p.id === id && p.action === action)) throw Error('启用的规则不存在');
      next.active[action] = id;
    }
  }
  for (const action of ['breakdown', 'optimize']) if (![...builtinProfiles, ...next.customProfiles].some(p => p.id === next.active[action] && p.action === action)) next.active[action] = defaults().active[action];
  settings = next;
  await persist();
  return publicAISettings();
}
export const activeProfile = action => [...builtinProfiles, ...settings.customProfiles].find(p => p.id === settings.active[action] && p.action === action);
