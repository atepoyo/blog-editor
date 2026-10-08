import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

const accessSchema = z.object({
  ACCESS_ISSUER: z.string().regex(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/),
  ACCESS_AUD: z.string().min(1),
  ALLOWED_EMAILS: z.string().transform((value) => value.split(',').map((email) => email.trim().toLowerCase()))
    .pipe(z.array(z.email()).nonempty()),
  EDITOR_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  }),
});

export type AccessConfig = z.infer<typeof accessSchema>;

export interface AccessEnvironment {
  ACCESS_ISSUER?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  EDITOR_ORIGIN?: string;
}

export function accessConfig(environment: unknown): AccessConfig {
  return accessSchema.parse(environment);
}

let keys: { issuer: string; resolver: JWTVerifyGetKey } | undefined;

function issuerKeys(issuer: string): JWTVerifyGetKey {
  if (keys?.issuer !== issuer) {
    keys = { issuer, resolver: createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer)) };
  }
  return keys.resolver;
}

export async function verifyAccess(request: Request, config: AccessConfig, resolver = issuerKeys(config.ACCESS_ISSUER)): Promise<boolean> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, resolver, {
      issuer: config.ACCESS_ISSUER,
      audience: config.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    const identity = z.object({ email: z.email(), type: z.literal('app') }).safeParse(payload);
    return identity.success && config.ALLOWED_EMAILS.includes(identity.data.email.toLowerCase());
  } catch {
    return false;
  }
}

export function allowedOrigin(request: Request, config: AccessConfig): boolean {
  return request.method !== 'POST' || request.headers.get('origin') === config.EDITOR_ORIGIN;
}

export function response(status: number, body: object): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
