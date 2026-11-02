async function req(method, url, body, opts = {}) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    body: body === undefined ? undefined : body instanceof Blob || body instanceof ArrayBuffer ? body : JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
  if (!r.ok) throw new Error(data?.error || `请求失败（${r.status}）`);
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b = {}) => req('POST', u, b),
  patch: (u, b) => req('PATCH', u, b),
  put: (u, b) => req('PUT', u, b),
  del: (u) => req('DELETE', u),
  upload: (file, { parentId, collectionId } = {}) => {
    const q = new URLSearchParams();
    if (parentId) q.set('parentId', parentId);
    if (collectionId) q.set('collectionId', collectionId);
    return req('POST', `/api/upload?${q}`, file, { headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
  },
};

export const fileUrl = (id) => `/api/file/${id}`;
