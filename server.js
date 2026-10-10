import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAISettings, aiSettings, aiConfigured, publicAISettings, updateAISettings, activeProfile } from './ai-settings.js';
import { getCaseOriginal, originalSources } from './case-originals.js';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(projectRoot, 'public');
try {
  for (const line of readFileSync(resolve(projectRoot, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* optional local configuration */ }

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
await loadAISettings();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const allowedFields = ['basic', 'subject', 'action', 'vfx', 'scene', 'composition', 'angle', 'movement', 'focus', 'environment', 'lighting', 'transition', 'sound', 'rhythm', 'equipment', 'lensStyle', 'art', 'constraints'];

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('请求内容过大');
  }
  return JSON.parse(raw);
}

function modelMessages(action, draft, term) {
  const base = '你是视频提示词撰写助手。使用简体中文，表达具体、可观察，避免空泛质量词。不要声称型号、焦段或特效一定会被生成模型准确执行。只输出一个 JSON 对象，不要代码围栏。';
  if (action === 'breakdown') return [
    { role: 'system', content: `${base} 当前任务规则：${activeProfile('breakdown')?.instruction || ''} 返回格式为 {"global":{"subject":"...","art":"..."},"shots":[{"visual":"...","camera":"...","sound":"..."}]}。global 的键只能来自：basic,subject,equipment,lensStyle,art,rhythm,constraints。shots 最多 6 个，每个只含 visual,camera,sound。建议简洁，不要编造创意以外的情节。` },
    { role: 'user', content: `请拆解这个创意，给出全片与逐镜头建议：\n${JSON.stringify({ idea: draft.idea, aspect: draft.aspect, duration: draft.duration, mode: draft.mode, shared: draft.shared, shots: draft.shots })}` }
  ];
  if (action === 'optimize') return [
    { role: 'system', content: `${base} 当前任务规则：${activeProfile('optimize')?.instruction || ''} 返回格式为 {"text":"完整的优化后提示词"}。保留原有主体、事件、时长和明确约束，解决重复或矛盾表述。不要添加用户没有提出的重要情节。` },
    { role: 'user', content: `请优化以下视频提示词：\n${String(draft.prompt || '').slice(0, 30_000)}` }
  ];
  return [
    { role: 'system', content: `${base} 返回格式为 {"text":"简短解释、适用情境和一个可改写例句"}。` },
    { role: 'user', content: `解释术语：${JSON.stringify(term)}` }
  ];
}

async function handleAI(req, res) {
  if (!aiConfigured()) return json(res, 503, { error: 'AI 尚未配置，请在设置页填写并保存连接信息。' });
  let data;
  try { data = await readBody(req); } catch { return json(res, 400, { error: '请求格式不正确或内容过大。' }); }
  if (!['breakdown', 'optimize', 'explain'].includes(data.action) || typeof data.draft !== 'object' || !data.draft) return json(res, 400, { error: '请求参数不正确。' });
  if (data.action === 'explain' && (!data.term || typeof data.term.nameZh !== 'string')) return json(res, 400, { error: '缺少术语。' });
  let endpoint;
  try { endpoint = new URL(aiSettings().baseUrl.replace(/\/$/, '') + '/chat/completions'); if (!['http:', 'https:'].includes(endpoint.protocol)) throw Error(); } catch { return json(res, 500, { error: '接口地址无效。' }); }
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiSettings().apiKey}` }, body: JSON.stringify({ model: aiSettings().model, temperature: 0.5, messages: modelMessages(data.action, data.draft, data.term) }), signal: AbortSignal.timeout(45_000) });
    if (!response.ok) return json(res, 502, { error: `模型服务返回 ${response.status}。请检查地址、模型名和密钥。` });
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('模型没有返回文本');
    const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const result = JSON.parse(clean);
    if (data.action === 'breakdown') {
      if (!result.global || typeof result.global !== 'object' || !Array.isArray(result.shots)) throw new Error('模型返回格式不正确');
      result.global = Object.fromEntries(Object.entries(result.global).filter(([key, value]) => ['basic', 'subject', 'equipment', 'lensStyle', 'art', 'rhythm', 'constraints'].includes(key) && typeof value === 'string').map(([key, value]) => [key, value.slice(0, 800)]));
      result.shots = result.shots.slice(0, 6).map(shot => Object.fromEntries(['visual', 'camera', 'sound'].filter(key => typeof shot?.[key] === 'string').map(key => [key, shot[key].slice(0, 1000)])));
    } else if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('模型返回格式不正确');
    else result.text = result.text.slice(0, 40_000);
    return json(res, 200, { result });
  } catch (error) { return json(res, 502, { error: error?.name === 'TimeoutError' ? '模型响应超时，请稍后重试。' : '模型返回不可用，请检查服务配置后重试。' }); }
}

async function testAI(res) {
  if (!aiConfigured()) return json(res, 503, { error: '请先保存完整的接口地址、模型和密钥。' });
  try {
    const endpoint = new URL(aiSettings().baseUrl.replace(/\/$/, '') + '/chat/completions');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiSettings().apiKey}` }, body: JSON.stringify({ model: aiSettings().model, messages: [{ role: 'user', content: '请只回复 OK' }], max_tokens: 8 }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return json(res, 502, { error: `连接失败：模型服务返回 ${response.status}。` });
    return json(res, 200, { ok: true });
  } catch (error) { return json(res, 502, { error: error?.name === 'TimeoutError' ? '连接超时。' : '无法连接模型服务，请检查接口地址和网络。' }); }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/status' && req.method === 'GET') return json(res, 200, { configured: aiConfigured() });
  if (pathname.startsWith('/api/case-original/') && req.method === 'GET') {
    const id = pathname.slice('/api/case-original/'.length);
    if (!Object.hasOwn(originalSources, id)) return json(res, 404, { error: '没有收录此案例原文。' });
    try { return json(res, 200, await getCaseOriginal(id)); }
    catch (error) {
      const message = error?.message || '';
      if (message.includes('未收录或不完整')) return json(res, 404, { error: '原始来源尚未公开完整提示词，或对应记录已变化。', sourceUrl: originalSources[id].sourceUrl });
      if (message.includes('定位失败')) return json(res, 502, { error: '来源页面结构已变化，暂无法确认这条原文。', sourceUrl: originalSources[id].sourceUrl });
      return json(res, 503, { error: '当前无法连接原始来源，请稍后重试或打开来源链接查看。', sourceUrl: originalSources[id].sourceUrl });
    }
  }
  if (pathname === '/api/ai-settings' && req.method === 'GET') return json(res, 200, publicAISettings());
  if (pathname === '/api/ai-settings' && req.method === 'POST') {
    if (req.headers.origin && req.headers.origin !== `http://${host}:${port}`) return json(res, 403, { error: '请求来源不正确。' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '仅支持 JSON。' });
    try { return json(res, 200, await updateAISettings(await readBody(req))); } catch (error) { return json(res, 400, { error: error.message || '设置保存失败。' }); }
  }
  if (pathname === '/api/ai-test' && req.method === 'POST') {
    if (req.headers.origin && req.headers.origin !== `http://${host}:${port}`) return json(res, 403, { error: '请求来源不正确。' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '仅支持 JSON。' });
    return testAI(res);
  }
  if (pathname === '/api/ai' && req.method === 'POST') {
    if (req.headers.origin && req.headers.origin !== `http://${host}:${port}`) return json(res, 403, { error: '请求来源不正确。' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: '仅支持 JSON。' });
    return handleAI(req, res);
  }
  if (pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在。' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '不支持的请求方式。' });
  let path;
  try { path = resolve(publicRoot, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname)); } catch { return json(res, 400, { error: '路径无效。' }); }
  if (path !== publicRoot && !path.startsWith(publicRoot + sep)) return json(res, 403, { error: '无权访问。' });
  try { const info = await stat(path); if (!info.isFile()) throw Error(); const body = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body); } catch { json(res, 404, { error: '文件不存在。' }); }
});

server.listen(port, host, () => console.log(`画面语法已启动：http://${host}:${port}`));
