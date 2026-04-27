import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

const PROXY_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy'
];

let activeProxy = '';
let activeDispatcher = null;

function normalizeUrl(url) {
  if (url.pathname === '/' && !url.search && !url.hash) {
    return `${url.protocol}//${url.host}`;
  }
  return url.toString();
}

export function normalizeNetworkProxy(proxyValue) {
  if (proxyValue === undefined || proxyValue === null) {
    return '';
  }

  if (typeof proxyValue !== 'string') {
    throw new Error('代理地址必须是字符串');
  }

  const trimmed = proxyValue.trim();
  if (!trimmed) {
    return '';
  }

  const candidate = PROXY_PROTOCOL_PATTERN.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('代理地址格式不正确');
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('代理地址必须使用 http:// 或 https://');
  }

  if (!parsed.hostname) {
    throw new Error('代理地址缺少主机名');
  }

  return normalizeUrl(parsed);
}

function applyProxyEnv(proxyValue) {
  PROXY_ENV_KEYS.forEach((key) => {
    if (proxyValue) {
      process.env[key] = proxyValue;
    } else {
      delete process.env[key];
    }
  });
}

export function applyNetworkProxy(proxyValue) {
  const normalized = normalizeNetworkProxy(proxyValue);

  if (normalized === activeProxy) {
    return normalized;
  }

  const nextDispatcher = normalized
    ? new ProxyAgent(normalized)
    : new Agent();

  setGlobalDispatcher(nextDispatcher);
  applyProxyEnv(normalized);

  const previousDispatcher = activeDispatcher;
  activeDispatcher = nextDispatcher;
  activeProxy = normalized;

  if (previousDispatcher && typeof previousDispatcher.close === 'function') {
    previousDispatcher.close().catch(() => { });
  }

  return activeProxy;
}

export function getActiveNetworkProxy() {
  return activeProxy;
}
