import crypto from 'crypto';

// Token assinado, específico para o Painel de Metas. Nenhum userId enviado pelo navegador
// é considerado prova de identidade. Configure METAS_SESSION_SECRET (>=32 caracteres) no Render.
type Payload = { sub: string; exp: number; rev: string };

const signingSecret = () => String(process.env.METAS_SESSION_SECRET || '');
const rev = (passwordHash: string) => crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 20);
const b64 = (input: string) => Buffer.from(input, 'utf8').toString('base64url');

export function issueMetasToken(id: string, passwordHash: string): string | null {
  const secret = signingSecret();
  if (secret.length < 32) return null;
  const body = b64(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 8 * 3600, rev: rev(passwordHash) }));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyMetasToken(token: string, passwordHash: string): string | null {
  const secret = signingSecret();
  if (secret.length < 32 || token.length > 4096) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (!value.sub || value.exp <= Math.floor(Date.now() / 1000) || value.rev !== rev(passwordHash)) return null;
    return String(value.sub);
  } catch { return null; }
}

export function readMetasToken(token: string): string | null {
  // Apenas extrai o ID para localizar o hash; NÃO autoriza o acesso.
  try {
    if (token.length > 4096 || token.split('.').length !== 2) return null;
    const payload = JSON.parse(Buffer.from(token.split('.')[0] || '', 'base64url').toString('utf8')) as Payload;
    return typeof payload.sub === 'string' && payload.sub.length < 128 ? payload.sub : null;
  } catch { return null; }
}
