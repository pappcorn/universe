// The thin HTTP layer over LinkedIn's versioned REST API (api.linkedin.com/rest).
// Every call carries the three headers LinkedIn requires — Authorization,
// LinkedIn-Version (YYYYMM) and X-Restli-Protocol-Version: 2.0.0 — and every
// failure becomes a LinkedInApiError whose message carries LinkedIn's own error
// text and never the request (so never the token).
//
// Only two hosts ever see the access token: the API host, and LinkedIn's upload
// host for media bytes. uploadBinary() refuses any URL that is not https on
// linkedin.com, so a malformed or hostile upload URL cannot exfiltrate it.

import { getAccessToken, loadConfig } from './config';

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LinkedInApiError';
  }
}

/** URNs inside a URL path or query must be fully percent-encoded under
 *  Rest.li 2.0, including the parentheses and commas of composite URNs such as
 *  urn:li:comment:(urn:li:activity:1,2). encodeURIComponent leaves ( ) alone,
 *  so they are encoded explicitly. */
export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Rest.li 2.0 list syntax: List(a,b) with each item encoded. */
export function restliList(items: string[]): string {
  return `List(${items.map(encodeUrn).join(',')})`;
}

export interface ApiResponse<T> {
  status: number;
  /** The x-restli-id header — where LinkedIn returns a created entity's id. */
  restliId?: string;
  body: T;
}

function hint(status: number): string {
  switch (status) {
    case 401:
      return ' The access token is invalid or expired; run the setup script again.';
    case 403:
      return (
        ' The token lacks a scope this call needs, or the authorizing member is not an ' +
        'ADMINISTRATOR of the Page. Check your app has the Community Management API and that ' +
        'the setup requested the right scopes.'
      );
    case 426:
      return (
        ' The LinkedIn-Version this connector sends has been sunset. Set ' +
        'LINKEDIN_API_VERSION to a current YYYYMM version, or update the connector.'
      );
    case 429:
      return (
        ' Rate limit reached. Development-tier apps have a small daily call budget; wait ' +
        'and retry later.'
      );
    default:
      return '';
  }
}

async function errorFrom(res: Response): Promise<LinkedInApiError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const b = JSON.parse(text) as {
        message?: string;
        code?: string;
        serviceErrorCode?: number;
      };
      detail = [b.code, b.message].filter(Boolean).join(': ') || text;
    } catch {
      detail = text;
    }
  } catch {
    // no body
  }
  const clipped = detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
  return new LinkedInApiError(
    `LinkedIn API error (HTTP ${res.status})${clipped ? `: ${clipped}` : ''}.${hint(res.status)}`,
    res.status,
  );
}

export async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  opts: {
    query?: string;
    body?: unknown;
    restliMethod?: string;
  } = {},
): Promise<ApiResponse<T>> {
  const { apiUrl, apiVersion } = loadConfig();
  const url = `${apiUrl}/rest/${path}${opts.query ? `?${opts.query}` : ''}`;

  const send = async (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    };
    if (opts.restliMethod) headers['X-RestLi-Method'] = opts.restliMethod;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  };

  const token = await getAccessToken();
  let res = await send(token);
  // One renewal attempt on 401: LinkedIn can revoke a token before its stated
  // expiry. getAccessToken(true) fails cleanly when there is nothing to renew,
  // and renews once however many requests were refused at the same time.
  if (res.status === 401) res = await send(await getAccessToken(true, token));
  if (!res.ok) throw await errorFrom(res);

  const text = await res.text();
  let body: unknown = {};
  try {
    if (text) body = JSON.parse(text);
  } catch {
    // A write that LinkedIn accepted must not read as a failure, or someone
    // retries it: its id is in the header. A read has nothing to show.
    if (method === 'GET') {
      throw new LinkedInApiError(
        `LinkedIn answered HTTP ${res.status} with a body that is not JSON. Try again later.`,
        res.status,
      );
    }
  }
  return {
    status: res.status,
    restliId: res.headers.get('x-restli-id') ?? undefined,
    body: body as T,
  };
}

/** PUT raw bytes to the upload URL LinkedIn handed back. */
export async function uploadBinary(
  uploadUrl: string,
  bytes: Uint8Array,
): Promise<void> {
  let u: URL;
  try {
    u = new URL(uploadUrl);
  } catch {
    throw new LinkedInApiError('LinkedIn returned an invalid upload URL.', 0);
  }
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== 'https:' ||
    !(host === 'linkedin.com' || host.endsWith('.linkedin.com'))
  ) {
    throw new LinkedInApiError(
      `Refusing to upload to ${u.protocol}//${host}: upload URLs must be https on linkedin.com, ` +
        'and the access token is never sent anywhere else.',
      0,
    );
  }
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  if (!res.ok) throw await errorFrom(res);
}
