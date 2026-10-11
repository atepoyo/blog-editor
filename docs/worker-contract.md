# Worker送信契約

保護された投稿画面、Gateway、Publisherの間で使う契約です。共通Editorの `workerUrl` には、利用者自身の投稿画面URL（例: `https://publish.example.com/publish`）を設定します。公開画像URL・投稿先origin・リポジトリ・ブランチは利用者が選んだ環境の設定で決まります。[Cloudflare導入手順](cloudflare-setup.md)を参照してください。

## 認証と保存権限

共通Editorと投稿画面は別のHTTPS originです。投稿画面と同じ `publish.example.com` origin の `/publish`、`/assets/*`、`/posts` はGatewayが応答し、Gatewayの全トラフィックにCloudflare Accessを適用します。共通Editorの配信元は公開のままです。

Gatewayは `ctx.access.getIdentity()` で利用者を確認します。投稿画面は `POSTING_UI` Service Bindingで静的Workerから配信します。Gateway自体にStatic Assetsを付けません。内部routerでは `ctx.access` が利用できないためです。API要求は `PUBLISHER` Service BindingでPublisherへ渡します。CookieやAuthorizationは転送せず、Publisherは元の `Cf-Access-Jwt-Assertion` の署名、issuer、audience、有効期限、許可メールを独立して検証し、POSTでは投稿画面originの一致も要求します。

GitHub App秘密鍵、`IMAGES`、`DRAFTS` BindingはPublisherだけに置きます。リポジトリ・ブランチ・バケットは `GITHUB_*` とWorker設定で固定し、リクエストから別の保存先を指定できません。Publisherと投稿画面Workerへ公開ルート、workers.dev、プレビューURLを追加しないでください。

## Editorからの受け渡し

共通Editorはユーザー操作で開いた投稿画面の `Window` に、`postMessage` で `hello`、`ready`、`article`、`received` の手順を実行します。各方向で正確なHTTPS originと相手の `Window` を照合し、UUIDのメッセージIDとZodによる実行時検証を行います。写真はURLや共通サーバーに載せず、`Blob` としてstructured cloneで渡します。

投稿画面は記事のMarkdown・写真・投稿先を表示し、本人が「投稿を確定」を押すまで保存しません。受け渡し完了は保存成功ではありません。投稿結果、認証情報、Access token、クラウド下書きは、投稿フローではEditorへ返しません。元のEditorは下書きを維持します。投稿画面は受信データをメモリだけに保持するため、再読み込み後はEditorからの再送が必要です。

メッセージは余分なフィールドを許さないオブジェクトです。`id` はその画面間通信を識別するUUIDで、投稿権限を持つトークンではありません。

| type | その他のフィールド | 方向 |
| --- | --- | --- |
| `blog-md:hello` | `id` | Editor → 開いたタブ |
| `blog-md:ready` | `id` | タブ → opener |
| `blog-md:article` | `id`, `article: { markdown, path, images: [{ filename, path, blob }] }` | Editor → タブ |
| `blog-md:received` | `id` | タブ → Editor（受信のみの確認） |
| `blog-md:draft` | `id`, `baseRevision: UUID \| null`, `revision: UUID`, `title`, `body`, `photos: [{ filename, path, blob }]` | Editor → タブ |
| `blog-md:sync-result` | `id`, `action: saved \| loaded \| conflict`, `draft` | タブ → Editor（手動同期のみ） |

`blob` は空でないJPEG Blobです。受信した記事はmultipartの保存契約と同じ日付パス・UUID v4画像名・重複禁止の検証を行います。下書きは写真名・保存パス・JPEG型・写真の重複と版を検証します。同期結果の `draft` は下記のクラウド下書き形式です。JavaScriptの `File` をそのまま転送することには依存せず、受信側でBlobから再生成します。

画面間の受け渡し・手動同期結果を待つのは最大2分です。認証待ちのタイムアウト、タブを閉じた場合、ポップアップ拒否、またはCOOPによる`opener`切断では受け渡しを行わず、Editorの下書きと写真を保ちます。ログイン後、Editorから投稿を手動で再開してください。

## 手動下書き同期

自動同期のGETは行いません。Editorの「クラウドに保存」「クラウドから取得」で、投稿用URLと同じoriginの `/posts?draft=1` へ直接通信します。同期APIはAccess認証を確認して同じPublisherの `DRAFTS` 非公開R2を使います。異なる投稿URL、Publisher、バケット間の探索や自動共有はしません。旧Editorとの互換用に別タブの同期受け渡しも保持します。

取得した下書きは本文・写真と版情報だけをEditorへ返します。空または本文・全写真が同じ端末にはそのまま取り込みます。異なる内容がある場合は両方を保ち、どちらを使うか明示的に選んで解決します。EditorのJavaScriptは認証CookieやAccess JWTを読み取りません。IndexedDBの既存下書きと同期metadata、既存のWorker APIおよびR2データは維持します。

本人操作で同じ投稿originの `GET /posts?draft=1` または `POST /posts?draft=1` を使います。POSTは `application/json` の `{ baseRevision: UUID | null, draft }` です。`draft` は `{ version: 1, revision: UUID, title: string, body: string, photos: [{ name: UUID.jpg, path: images/UUID.jpg, data: Base64 }] }` です。GET/POST成功は `{ draft }`、GETの未保存状態は `{ draft: null }`、競合はHTTP 409と現在の `{ draft }` を返します。写真も本文と一つの非公開オブジェクトに条件付き保存し、部分更新を行いません。認証とPOST originは記事APIと同様に検証します。

## 投稿先の取得

投稿画面はAccess認証後に `GET /posts?destination=1` を行います。応答には固定された `owner`、`repository`、`branch` のみを含め、GitHub鍵や認証情報を含めません。投稿画面は画面上でoriginとこれらの保存先を表示してから、本人の確定操作を受け付けます。

## 存在確認

本人が確定操作を行った後、投稿画面と同じoriginの `/posts?path=posts%2FYYYY-MM-DD.md` にGETを送ります。

成功応答はJSONの `{ "exists": false }` または `{ "exists": true }` です。`true` の場合は `posts/YYYY-MM-DD-2.md`、`posts/YYYY-MM-DD-3.md` の順に空いている保存名を確認します。通信失敗、不正な応答、認証拒否の場合はPOSTへ進まず、画像も送信しません。Workerはここでも認証を確認します。

## 新規投稿

空いている保存名を確認後、投稿画面と同じoriginの `/posts` へ `POST multipart/form-data` を送ります。HTTP `409` で競合した場合のみ、次の番号を確認して投稿します。連番を付けるのは `manifest.articlePath` だけで、Markdownの日付・本文・写真は変更しません。Content-Typeとboundaryはブラウザに任せます。内部データの本体にFormDataは使用しません。

| フィールド | 内容 |
| --- | --- |
| `markdown` | タイトル・日付・画像URLを含む完成したMarkdown文字列 |
| `manifest` | 下記のJSON文字列 |
| `image-0`, `image-1`, … | 本文で参照される縮小JPEGのFile。元画像は含まない |

```json
{
  "version": 1,
  "articlePath": "posts/2026-10-07.md",
  "images": [
    {
      "field": "image-0",
      "filename": "550e8400-e29b-41d4-a716-446655440000.jpg",
      "path": "images/550e8400-e29b-41d4-a716-446655440000.jpg"
    }
  ]
}
```

画像は保存Workerに接続したR2バケットへ保存します。画像なしなら `images` は空配列です。URLはフロントで公開URLと画像パスから生成済みです。WorkerでMarkdownを生成・書き換えたり、画像URLのアップロード応答を待ったりしません。リクエストで画像の保存方式を指定するフィールドはありません。

## 保存と応答

保存Workerは実在する日付の `posts/YYYY-MM-DD.md`、2以上の連番を付けた `posts/YYYY-MM-DD-N.md`（先頭のゼロは不可）とUUID v4の `images/UUID.jpg` だけを受け付けます。余分なフィールド・重複・ファイル名やMIMEの不一致を拒否し、画像を保存してから記事を保存します。JPEGのバイナリ内容や寸法の再検証は行いません。

記事の最終保存は必ずcreate-onlyです。事前のGETは競合を防げないため、POSTで既存記事を更新してはいけません。同じ保存名の記事が存在した場合、事前確認後の競合も含めてHTTP `409` を返し、フロントは次の番号へ進みます。

すべて保存できた場合のみHTTP `201` と次のJSONを返します。

```json
{ "articlePath": "posts/2026-10-07.md" }
```

フロントはHTTPステータス、JSONの型、articlePathの一致を確認します。その他の応答を保存成功として扱いません。認証拒否は `401` / `403`、その他の失敗は非2xxとします。

記事のGET/POSTは `credentials: same-origin`、`redirect: error` で送ります。認証期限切れの転送を追従して本文・写真を別のログイン先へ再送せず、投稿画面に保持します。同期APIも転送を自動追従しません。

画像保存に失敗した場合は記事を保存しません。フロントは失敗後も入力と縮小画像、固定した画像名を保持します。送信中は編集と重複送信を止めます。

multipartを一度送ることは保存全体のトランザクションを保証しません。現在の実装案は記事保存に失敗しても画像を削除せず、利用者が再送したときに同名・同じ内容の画像だけ再利用します。同名の別画像は上書きしません。この残存画像の扱いは公開前の確認事項です。応答を受け取れない場合も、保存済みかどうかはフロントでは確定できません。

記事APIは投稿画面と同じorigin専用です。Gatewayは `/posts?draft=1` に限り、`COMMON_EDITOR_ORIGIN` と一致するoriginへの資格情報付きCORSを許可します。認証Cookieはブラウザが `credentials: include` で送ります。POSTのJSON本文は `text/plain` で送り、Publisherのruntime schemaで検証します。API応答は `Cache-Control: no-store` とし、Service Workerは投稿画面・投稿APIをキャッシュしません。認証情報や保存先のエラー本文を利用者へ返しません。
