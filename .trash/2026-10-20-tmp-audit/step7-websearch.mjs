const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'web.search', arguments: { query: 'node.js zstd' } } };
const t0 = Date.now();
try {
  const r = await fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  const c = j.result?.content;
  const txt = Array.isArray(c) ? c.map((x) => x.text ?? '').join(' ') : JSON.stringify(j);
  console.log('status:', r.status, 'elapsed:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('result head:', String(txt).slice(0, 400).replace(/\n/g, ' | '));
} catch (e) {
  console.log('EXC after', ((Date.now() - t0) / 1000).toFixed(1) + 's:', e.message);
}
