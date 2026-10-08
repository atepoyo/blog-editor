# Worker送信契約

フロントと `worker/` の保存処理で共有するAPIです。公開URL、対象リポジトリ、ブランチは利用者自身が設定します。[Cloudflare導入手順](cloudflare-setup.md)を参照してください。

## 認証と保存権限

エディタと同じオリジンの `/posts` と `/auth/login` を公開Workerへルーティングし、CloudflareのWorker単位のAccessで保護します。編集と下書き保存はログインなしで使えます。ログイン後の同一オリジンfetchにブラウザがCookieを付け、JavaScriptは認証トークンを読み取ったり保存したりしません。

公開Workerは `ctx.access.getIdentity()` を確認し、Service Bindingで非公開の保存Workerへ元の `Cf-Access-Jwt-Assertion` を渡します。CookieやAuthorizationは転送しません。保存WorkerはそのJWTの署名、issuer、audience、有効期限、許可メールを独立して検証し、POSTでは設定されたエディタのOriginも要求します。

GitHub App秘密鍵とR2 Bindingは保存Workerだけに置きます。リポジトリ・ブランチ・バケットはWorker設定から決まり、リクエストでは指定できません。保存Workerへ公開ルート、workers.dev、プレビューURLを追加しないでください。

## 存在確認

設定されたWorker URLに `GET ?path=posts%2FYYYY-MM-DD.md` を送ります。

成功応答はJSONの `{ "exists": false }` または `{ "exists": true }` です。`true`、通信失敗、不正な応答、認証拒否の場合はPOSTへ進まず、画像も送信しません。Workerはここでも認証を確認します。

## 新規投稿

同じWorker URLへ一度の `POST multipart/form-data` を送ります。Content-Typeとboundaryはブラウザに任せます。内部データの本体にFormDataは使用しません。

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

保存Workerは実在する日付の `posts/YYYY-MM-DD.md` とUUID v4の `images/UUID.jpg` だけを受け付けます。余分なフィールド・重複・ファイル名やMIMEの不一致を拒否し、画像を保存してから記事を保存します。JPEGのバイナリ内容や寸法の再検証は行いません。

記事の最終保存は必ずcreate-onlyです。事前のGETは競合を防げないため、POSTで既存記事を更新してはいけません。同じ日の記事が存在した場合、事前確認後の競合も含めてHTTP `409` を返します。

すべて保存できた場合のみHTTP `201` と次のJSONを返します。

```json
{ "articlePath": "posts/2026-10-07.md" }
```

フロントはHTTPステータス、JSONの型、articlePathの一致を確認します。その他の応答を保存成功として扱いません。認証拒否は `401` / `403`、その他の失敗は非2xxとします。

画像保存に失敗した場合は記事を保存しません。フロントは失敗後も入力と縮小画像、固定した画像名を保持します。送信中は編集と重複送信を止めます。

multipartを一度送ることは保存全体のトランザクションを保証しません。現在の実装案は記事保存に失敗しても画像を削除せず、利用者が再送したときに同名・同じ内容の画像だけ再利用します。同名の別画像は上書きしません。この残存画像の扱いは公開前の確認事項です。応答を受け取れない場合も、保存済みかどうかはフロントでは確定できません。

付属Workerは同一オリジン専用でCORSを公開しません。別オリジンの互換Workerへ接続する場合、そのWorker側で認証・CORSの対応が必要です。API応答は `Cache-Control: no-store` とし、エディタのService Workerも投稿API・ログイン画面をキャッシュしません。認証情報や保存先のエラー本文を利用者へ返しません。
