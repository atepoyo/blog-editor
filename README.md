# Blog.md

A small, mobile-first Markdown blog editor built with React, TypeScript and Vite. The interface supports English and Japanese.

This repository contains the shared public Editor and the per-user Cloudflare Gateway, protected posting page, and Publisher. Each user runs the posting Workers in their own Cloudflare account and installs their own GitHub App on one personal repository. The Editor and protected posting page use separate HTTPS origins. Cloudflare Access protects the posting page and API; the Editor stores no GitHub credentials. See the [setup guide](docs/cloudflare-setup.md) and [Worker API contract](docs/worker-contract.md). Deployment is a separate step.

Users manage their own GitHub App private key in their private publisher Worker's Secret, including revocation and replacement. Posting and storage use each user's resources; there is no shared posting backend or central key custody. The publisher can read its own key, so the safety of the deployed code and accounts still matters.

## Getting started

Requires Node.js 22.12+ and pnpm 11.19.

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to create a production build in `dist/`. Host the editor over HTTPS for posting and offline support.

The shared Editor is served publicly. A user's `worker/posting-ui.example.jsonc` serves the protected confirmation page, while the Gateway serves it through a Service Binding after Access authentication. The Gateway has no Static Assets binding. See the setup guide for the per-user origins and Worker bindings.

## Usage

1. Enter a title and write the body in Markdown.
2. Press and hold in the body or choose **Add photo** to insert a photo. Captions are optional.
3. Choose **Post** to open your protected posting page in a popup and transfer the article and photos directly between the two windows. Review the rendered article and GitHub repository there, then click **投稿を確定** to save. The title and date are included in the saved Markdown; photos are stored in your R2 bucket.

Open **Help** for instructions and **Settings** to configure your public R2 image URL and protected posting page URL.

## Settings

- **Public image URL:** The base URL that serves your images, such as `https://img.example.com/`. The editor appends `images/<UUID>.jpg`. Required for posts with photos.
- **Posting page URL:** The protected posting page URL, such as `https://publish.example.com/publish`. The setting key remains `workerUrl` internally. The page origin must match the Gateway and Publisher configuration. You can edit and save drafts without configuring a posting page.

## Output and storage

Posts include `title` and `date` in YAML frontmatter and use `posts/YYYY-MM-DD.md`, based on the device's local date. When that path exists, posting chooses the first available suffix: `posts/YYYY-MM-DD-2.md`, `posts/YYYY-MM-DD-3.md`, and so on. Existing articles are never overwritten, and the frontmatter date stays unchanged.

Photos are converted to JPEG with a maximum edge of 1920px. Posting saves referenced photos in your R2 bucket before saving the article in GitHub.

One current draft, resized photos and settings are saved locally in IndexedDB and restored when you return to the same browser and Editor origin. Posting transfers a prepared article and photo Blobs from the Editor to the protected page with `postMessage`; the content is not put in a URL or sent through the shared Editor server. The Editor receives only a receipt that the protected page accepted the transfer. It keeps the draft after handoff, and handoff completion does not mean the post was saved. The protected page holds the received content in memory; reload it and send the article again from the Editor. Clearing browser data or browser storage eviction can remove local data.

Drafts can be synchronized manually between devices that use the same posting URL, Publisher, and private R2 draft bucket. Use **クラウドに保存** or **クラウドから取得** in the Editor; no sync tab opens. Authenticate through Settings first when needed. The browser sends the posting service's cookie, while the Editor does not read credentials or Access tokens. The Gateway allows credentialed CORS only for draft sync from its pinned common Editor origin. Empty or identical local drafts adopt the retrieved draft directly; differing local drafts keep both versions until you choose one. The Editor does not fetch cloud drafts automatically. Existing IndexedDB drafts, sync metadata, and Worker/R2 sync data are retained.

The production build caches the editor with a Service Worker and Cache API. Open it online once and wait for the offline-ready message before using it offline. Writing, adding photos and saving drafts work offline. Posting requires a connection and a click on **Post**; nothing is posted automatically.

Drafts from the previous image-storage selector retain their text and photos. Existing R2 URLs are preserved; a previous GitHub image URL is cleared so you can configure an R2 URL before posting photos.

## Development

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
```

Browser tests run against a production build. The Service Worker is disabled in the development server.

Check Worker bundles without deploying:

```sh
pnpm exec wrangler deploy --dry-run --config worker/editor.example.jsonc
pnpm exec wrangler deploy --dry-run --config worker/gateway.example.jsonc
pnpm exec wrangler deploy --dry-run --config worker/posting-ui.example.jsonc
pnpm exec wrangler deploy --dry-run --config worker/publisher.example.jsonc
```
