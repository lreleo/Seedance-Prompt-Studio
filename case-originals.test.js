import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOfficialPrompt, extractCommunityPrompt, originalSources } from './case-originals.js';

test('all built-in cases have fixed source mappings', () => {
  assert.equal(Object.keys(originalSources).length, 12);
  for (const item of Object.values(originalSources)) assert.match(item.sourceUrl, /^https:\/\//);
});

test('official prompt extraction preserves text but omits the source label', () => {
  const html = '<em>T2V prompt: Camera &amp; light.<br>Second line.</em>';
  assert.equal(extractOfficialPrompt(html, 'Camera & light.'), 'Camera & light.\nSecond line.');
  assert.throws(() => extractOfficialPrompt(html, 'Missing'), /定位失败/);
});

test('community extraction requires matching id, title, and complete original prompt', () => {
  const fixture = [{ id:'case-1', title:{fallback:{en:'Test Case'}}, prompt:{originalLanguage:'en',fallback:{en:'First line.\nSecond line.'}}, source:{promptStatus:'complete',author:{name:'Author'}} }];
  assert.equal(extractCommunityPrompt(fixture,'case-1','Test Case').text,'First line.\nSecond line.');
  assert.throws(() => extractCommunityPrompt(fixture,'case-1','Another Case'), /未收录/);
});
