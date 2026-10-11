import { createPrivateKey } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

const githubSchema = z.object({
  GITHUB_APP_ID: z.string().regex(/^\d+$/),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_OWNER: z.string().regex(/^[a-zA-Z0-9-]+$/),
  GITHUB_REPOSITORY: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
  GITHUB_BRANCH: z.string().min(1),
});

const ownerSchema = z.object({ login: z.string(), type: z.literal('User') });
const installationSchema = z.object({ id: z.number().int().positive(), account: ownerSchema });
const tokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.iso.datetime(),
  repositories: z.array(z.object({ name: z.string(), owner: ownerSchema })).length(1),
  permissions: z.strictObject({ contents: z.literal('write'), metadata: z.literal('read') }),
});
const contentFileSchema = z.object({ content: z.string(), encoding: z.literal('base64'), sha: z.string().regex(/^[\da-f]{40}$/i) });
const directorySchema = z.array(z.object({ type: z.string(), path: z.string() }));

export class StorageError extends Error {
  constructor() { super('保存先への操作に失敗しました。'); }
}

export class ArticleConflictError extends Error {
  constructor() { super('同日の記事が既に存在します。'); }
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export class GitHubStore {
  private readonly base: string;
  private readonly request: typeof fetch;

  private constructor(
    private readonly token: string,
    owner: string,
    repository: string,
    private readonly branch: string,
    request: typeof fetch,
  ) {
    this.base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
    // WorkersのfetchはGitHubStoreをthisにすると例外になるため、呼び出し時のreceiverを分離する。
    this.request = (input, init) => request(input, init);
  }

  static async connect(environment: unknown, request: typeof fetch = fetch): Promise<GitHubStore> {
    const config = githubSchema.parse(environment);
    const pem = createPrivateKey(config.GITHUB_APP_PRIVATE_KEY).export({ type: 'pkcs8', format: 'pem' }).toString();
    const key = await importPKCS8(pem, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(config.GITHUB_APP_ID)
      .setIssuedAt(now - 60).setExpirationTime(now + 300).sign(key);
    const appHeaders = GitHubStore.headers(jwt);
    const base = `https://api.github.com/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(config.GITHUB_REPOSITORY)}`;
    // Workersはredirect: errorを受け付けない。manualで転送を止め、期待したステータス以外は拒否する。
    const installationResponse = await request(`${base}/installation`, { headers: appHeaders, redirect: 'manual' });
    if (!installationResponse.ok) throw new StorageError();
    const installation = installationSchema.parse(await installationResponse.json());
    if (installation.account.login.toLowerCase() !== config.GITHUB_OWNER.toLowerCase()) throw new StorageError();
    const tokenResponse = await request(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
      method: 'POST', headers: appHeaders, redirect: 'manual',
      body: JSON.stringify({ repositories: [config.GITHUB_REPOSITORY], permissions: { contents: 'write', metadata: 'read' } }),
    });
    if (tokenResponse.status !== 201) throw new StorageError();
    const token = tokenSchema.parse(await tokenResponse.json());
    const repository = token.repositories[0];
    if (!repository || repository.name !== config.GITHUB_REPOSITORY || repository.owner.login.toLowerCase() !== config.GITHUB_OWNER.toLowerCase()
      || Date.parse(token.expires_at) <= Date.now()) throw new StorageError();
    return new GitHubStore(token.token, config.GITHUB_OWNER, config.GITHUB_REPOSITORY, config.GITHUB_BRANCH, request);
  }

  private static headers(token: string): Headers {
    return new Headers({
      authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'content-type': 'application/json', 'user-agent': 'blog-editor', 'x-github-api-version': '2026-03-10',
    });
  }

  private contentUrl(path: string): URL {
    const url = new URL(`${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
    url.searchParams.set('ref', this.branch);
    return url;
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.request(this.contentUrl(path), { headers: GitHubStore.headers(this.token), redirect: 'manual' });
    if (result.status === 404) return false;
    if (result.status !== 200) throw new StorageError();
    return true;
  }

  async listArticles(): Promise<{ path: string; title: string }[]> {
    const result = await this.request(this.contentUrl('posts'), { headers: GitHubStore.headers(this.token), redirect: 'manual' });
    if (result.status === 404) return [];
    if (result.status !== 200) throw new StorageError();
    const entries = directorySchema.safeParse(await result.json().catch(() => null));
    if (!entries.success) throw new StorageError();
    const paths = entries.data.filter((entry) => entry.type === 'file' && /^posts\/\d{4}-\d{2}-\d{2}(?:-(?:[2-9]|[1-9]\d+))?\.md$/.test(entry.path))
      .map((entry) => entry.path).sort((left, right) => right.localeCompare(left));
    return Promise.all(paths.map(async (path) => {
      const article = await this.readArticle(path);
      if (!article) throw new StorageError();
      return { path, title: this.titleFromMarkdown(article.markdown) ?? path.slice(6, -3) };
    }));
  }

  async readArticle(path: string): Promise<{ markdown: string; sha: string } | null> {
    const result = await this.request(this.contentUrl(path), { headers: GitHubStore.headers(this.token), redirect: 'manual' });
    if (result.status === 404) return null;
    if (result.status !== 200) throw new StorageError();
    const file = contentFileSchema.safeParse(await result.json().catch(() => null));
    if (!file.success) throw new StorageError();
    try {
      const content = Buffer.from(file.data.content.replace(/\s/g, ''), 'base64');
      return { markdown: new TextDecoder('utf-8', { fatal: true }).decode(content), sha: file.data.sha };
    } catch { throw new StorageError(); }
  }

  private titleFromMarkdown(markdown: string): string | null {
    const encoded = /^---\r?\ntitle: ("(?:\\.|[^"\\])*")\r?\n/m.exec(markdown)?.[1];
    if (!encoded) return null;
    try {
      const title = z.string().safeParse(JSON.parse(encoded));
      return title.success && title.data.trim() ? title.data : null;
    } catch { return null; }
  }

  async createArticle(path: string, markdown: string): Promise<void> {
    const result = await this.create(path, encodeBase64(new TextEncoder().encode(markdown)), '記事を公開するため新規投稿を保存');
    if (result.status === 201) return;
    // GitHubは既存ファイルへのSHAなしのPUTを422で拒否する場合もある。
    if ((result.status === 409 || result.status === 422) && await this.exists(path)) throw new ArticleConflictError();
    throw new StorageError();
  }

  async updateArticle(path: string, markdown: string, sha: string): Promise<void> {
    const result = await this.request(`${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers: GitHubStore.headers(this.token), redirect: 'manual',
      body: JSON.stringify({ message: '記事を編集して内容を更新', content: encodeBase64(new TextEncoder().encode(markdown)), branch: this.branch, sha }),
    });
    if (result.status === 200) return;
    if (result.status === 409 || result.status === 422) throw new ArticleConflictError();
    throw new StorageError();
  }

  private create(path: string, content: string, message: string): Promise<Response> {
    return this.request(`${this.base}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers: GitHubStore.headers(this.token), redirect: 'manual',
      // SHAを受け取る更新用の経路を用意せず、記事の新規作成だけに限定する。
      body: JSON.stringify({ message, content, branch: this.branch }),
    });
  }
}
