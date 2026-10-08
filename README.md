# Blog.md

A small, mobile-first Markdown blog editor built with React, TypeScript and Vite. The interface supports English and Japanese.

This repository includes the editor and two Cloudflare Workers for posting. Each user hosts the editor on their own origin, runs the Workers in their own Cloudflare account, and installs their own GitHub App on one personal repository. The included posting API uses the editor's own origin. Cloudflare Access handles sign-in; the editor stores no GitHub credentials. See the [setup guide](docs/cloudflare-setup.md) and [Worker API contract](docs/worker-contract.md). Deployment is a separate step.

Users manage their own GitHub App private key in their private publisher Worker's Secret, including revocation and replacement. Posting and storage use each user's resources; there is no shared posting backend or central key custody. The publisher can read its own key, so the safety of the deployed code and accounts still matters.

## Getting started

Requires Node.js 22.12+ and pnpm 11.19.

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to create a production build in `dist/`. Host the editor over HTTPS for posting and offline support.

## Usage

1. Enter a title and write the body in Markdown.
2. Press and hold in the body or choose **Add photo** to insert a photo. Captions are optional.
3. Choose **Post** to send the article and photos to your configured backend. The title and date are included in the saved Markdown; photos are stored in R2.

Open **Help** for instructions and **Settings** to configure your public R2 image URL and posting endpoint.

## Settings

- **Public image URL:** The base URL that serves your images, such as `https://img.example.com/`. The editor appends `images/<UUID>.jpg`. Required for posts with photos.
- **Worker URL:** Your compatible posting API. For the included Workers, use the editor's own origin, such as `https://editor.example.com/posts`, and use **Sign in to post** before posting. You can edit and save drafts without configuring a posting endpoint.

## Output and storage

Posts include `title` and `date` in YAML frontmatter and use `posts/YYYY-MM-DD.md`, based on the device's local date. Posting stops if a post already exists for that date.

Photos are converted to JPEG with a maximum edge of 1920px. Posting saves referenced photos in your R2 bucket before saving the article in GitHub.

One current draft, resized photos and settings are saved locally in IndexedDB and restored when you return to the same browser and site URL. They stay on this device, not on a server. Clearing browser data or browser storage eviction can remove them; local storage is not a backup.

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
pnpm exec wrangler deploy --dry-run --config worker/gateway.example.jsonc
pnpm exec wrangler deploy --dry-run --config worker/publisher.example.jsonc
```
