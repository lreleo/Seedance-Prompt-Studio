const officialUrl = 'https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const communityUrl = 'https://github.com/ZeroLu/awesome-seedance-2.5/blob/main/data/community-x-seedance-cases.json';
const communityDataUrl = 'https://raw.githubusercontent.com/ZeroLu/awesome-seedance-2.5/main/data/community-x-seedance-cases.json';

export const originalSources = Object.freeze({
  'official-backstage': { kind: 'official', marker: 'One-take handheld gimbal tracking shot.', sourceUrl: officialUrl },
  'official-clay': { kind: 'official', marker: 'Refer to @Clay Render 1', sourceUrl: officialUrl },
  'official-soccer': { kind: 'official', marker: 'Using @Video 1', sourceUrl: officialUrl },
  'official-breakfast': { kind: 'official', marker: 'Edit @Video 1.', sourceUrl: officialUrl },
  'community-emotion': { kind: 'community', sourceId: 'x-sd25-01', sourceTitle: 'Tear-Filled Gunpoint Confrontation', sourceUrl: communityUrl },
  'community-medieval': { kind: 'community', sourceId: 'x-sd25-07', sourceTitle: 'Medieval Shame Walk', sourceUrl: communityUrl },
  'community-archive': { kind: 'community', sourceId: 'x-sd25-08', sourceTitle: '1970s Mediterranean Archival Walk', sourceUrl: communityUrl },
  'community-party': { kind: 'community', sourceId: 'x-sd25-10', sourceTitle: 'Brazil House Party Sequence Shot', sourceUrl: communityUrl },
  'community-ad': { kind: 'community', sourceId: 'x-sd25-17', sourceTitle: 'Heatwave Ice Water Cooldown Ad', sourceUrl: communityUrl },
  'community-beach': { kind: 'community', sourceId: 'x-sd25-19', sourceTitle: 'Beach Day Phone Memory Montage', sourceUrl: communityUrl },
  'community-antique': { kind: 'community', sourceId: 'x-sd25-20', sourceTitle: 'Antique Market Multi-Reference Test', sourceUrl: communityUrl },
  'community-umbrella': { kind: 'community', sourceId: 'x-sd25-21', sourceTitle: 'The Umbrella Escape', sourceUrl: communityUrl }
});

function decodeEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27|#x([0-9a-f]+)|#([0-9]+));/gi, (match, hex, decimal) => {
    if (hex || decimal) {
      try { return String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10)); } catch { return match; }
    }
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#39;': "'", '&#x27;': "'" }[match.toLowerCase()] || match;
  });
}

export function extractOfficialPrompt(html, marker) {
  const matches = [...html.matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/gi)]
    .map(match => decodeEntities(match[1].replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')).trim())
    .filter(text => /^(?:T2V|R2V) prompt:\s*/i.test(text) && text.includes(marker));
  if (matches.length !== 1) throw new Error('官方原文定位失败');
  return matches[0].replace(/^(?:T2V|R2V) prompt:\s*/i, '');
}

export function extractCommunityPrompt(data, sourceId, sourceTitle) {
  const item = data.find(entry => entry.id === sourceId);
  const language = item?.prompt?.originalLanguage;
  const prompt = item?.prompt?.fallback?.[language];
  if (item?.title?.fallback?.en !== sourceTitle || item?.source?.promptStatus !== 'complete' || !['en', 'zh'].includes(language) || typeof prompt !== 'string' || !prompt.trim()) throw new Error('社区原文未收录或不完整');
  return { text: prompt, language, author: item.source.author?.name || item.source.author?.username || '社区作者', authorUrl: item.source.tweetUrl || '' };
}

async function readLimited(url, limit) {
  const { stdout } = await execFileAsync('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '12', '--max-filesize', String(limit), url], { maxBuffer: limit + 1024, timeout: 14000, encoding: 'utf8' });
  return stdout;
}

const cache = new Map();
async function sourceText(kind) {
  const hit = cache.get(kind);
  if (hit && hit.expires > Date.now()) return hit.value;
  const url = kind === 'official' ? officialUrl : communityDataUrl;
  const raw = await readLimited(url, kind === 'official' ? 500_000 : 3_000_000);
  const value = kind === 'official' ? raw : JSON.parse(raw);
  cache.set(kind, { value, expires: Date.now() + 10 * 60_000 });
  return value;
}

export async function getCaseOriginal(id) {
  const source = originalSources[id];
  if (!source) return null;
  const data = await sourceText(source.kind);
  if (source.kind === 'official') return { text: extractOfficialPrompt(data, source.marker), language: 'en', author: '字节跳动 Seed', sourceUrl: source.sourceUrl };
  return { ...extractCommunityPrompt(data, source.sourceId, source.sourceTitle), sourceUrl: source.sourceUrl };
}
