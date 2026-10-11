import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import { z } from 'zod';
import type { Article } from './article';

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderNode(node: Nodes, key: number, images: Map<string, string>): ReactNode {
  const children = 'children' in node ? node.children.map((child, index) => renderNode(child, index, images)) : null;
  switch (node.type) {
    case 'root': return <>{children}</>;
    case 'text': return node.value;
    case 'paragraph': return <p key={key}>{children}</p>;
    case 'heading': {
      switch (node.depth) {
        case 1: return <h1 key={key}>{children}</h1>;
        case 2: return <h2 key={key}>{children}</h2>;
        case 3: return <h3 key={key}>{children}</h3>;
        case 4: return <h4 key={key}>{children}</h4>;
        case 5: return <h5 key={key}>{children}</h5>;
        case 6: return <h6 key={key}>{children}</h6>;
      }
    }
    case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
    case 'list': return node.ordered
      ? <ol key={key} start={node.start ?? undefined}>{children}</ol>
      : <ul key={key}>{children}</ul>;
    case 'listItem': return <li key={key}>{children}</li>;
    case 'emphasis': return <em key={key}>{children}</em>;
    case 'strong': return <strong key={key}>{children}</strong>;
    case 'delete': return <del key={key}>{children}</del>;
    case 'inlineCode': return <code key={key}>{node.value}</code>;
    case 'code': return <pre key={key}><code>{node.value}</code></pre>;
    case 'link': {
      const href = safeLink(node.url);
      return href ? <a key={key} href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
    }
    case 'image': {
      const src = safeLink(node.url);
      return src && ['http:', 'https:'].includes(new URL(src).protocol)
        ? <img key={key} src={images.get(new URL(src).pathname) ?? src} alt={node.alt ?? ''} title={node.title ?? undefined} />
        : null;
    }
    case 'break': return <br key={key} />;
    case 'thematicBreak': return <hr key={key} />;
    default: return null;
  }
}

export function MarkdownPreview({ article }: { article: Article }) {
  const [images, setImages] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    const urls = new Map(article.images.map((photo) => [`/${photo.path}`, URL.createObjectURL(photo.file)]));
    setImages(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [article.images]);

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(article.markdown);
  const titleValue = (frontmatter?.[1] ?? '').match(/^title:\s*("(?:\\.|[^"\\])*")\s*$/m)?.[1];
  let title = '';
  if (titleValue) {
    try {
      const parsedTitle = z.string().safeParse(JSON.parse(titleValue));
      if (parsedTitle.success) title = parsedTitle.data;
    } catch { title = ''; }
  }
  const body = frontmatter ? article.markdown.slice(frontmatter[0].length) : article.markdown;
  const content = fromMarkdown(body);

  return <article className="article-preview" aria-label="記事のプレビュー">
    {title && <h1>{title}</h1>}
    {content.children.map((node, index) => renderNode(node, index, images))}
  </article>;
}
