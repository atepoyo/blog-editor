# Blog.md

A small, mobile-first Markdown blog editor built with React, TypeScript and Vite. The interface supports English and Japanese.

This repository contains the frontend only. Posting requires a backend that implements the [Worker API contract](docs/worker-contract.md); the Worker, authentication and deployment are not included.

## Getting started

Requires Node.js 22.12+ and pnpm 11.19.

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to create a production build in `dist/`. Use HTTPS when hosting the editor to enable clipboard access on mobile.

## Usage

1. Enter a title and write the body in Markdown.
2. Press and hold in the body or choose **Add photo** to insert a photo. Captions are optional.
3. Choose **Copy Markdown** to export your post, or **Post** to send it to a configured backend.

Open **Help** for instructions and **Settings** to configure image storage and the posting endpoint.

## Settings

- **Image storage:** Cloudflare R2 or GitHub.
- **Public image URL:** The base URL that serves your images, such as `https://img.example.com/`. The editor appends `images/<UUID>.jpg`. Required for posts with photos.
- **Worker URL:** Your compatible posting API, such as `https://app.me.workers.dev/posts`. Leave it empty if you only copy Markdown.

## Output and storage

Posts include `title` and `date` in YAML frontmatter and use `posts/YYYY-MM-DD.md`, based on the device's local date. Posting stops if a post already exists for that date.

Photos are converted to JPEG with a maximum edge of 1920px. Copying Markdown does not upload photos; their files must also be placed in the configured image storage.

Drafts, photos and settings are held in memory only. Reloading or closing the page clears them.

## Development

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
```
