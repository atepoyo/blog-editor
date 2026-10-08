# 自分のCloudflareで投稿する

利用者ごとにCloudflare・GitHubのリソースを用意します。エディタの配布元が利用者の秘密鍵を預かる構成にはしません。アカウント作成、Secret登録、リソース作成、デプロイはこのリポジトリのローカル検証とは別の操作です。

利用者が自分のGitHub App秘密鍵を自分の保存WorkerのSecretへ登録し、保管・失効・再発行、アカウントとアクセス権、利用料金を管理します。配布元には利用者のアカウントへの管理権限を渡しません。追加の鍵管理サービスやパスキーによる投稿承認は、この構成の前提にしません。

付属Workerは同一オリジン専用です。エディタのビルドも各自の配信先へ置き、同じオリジンの投稿APIを自分のGatewayへルーティングします。

## 構成と残る責任

```text
ブラウザ ─ 編集・下書き保存（認証不要）
   │
   └ Cloudflare Accessでログイン
       └ 同じオリジンの /posts → 公開Worker
                                  └ Service Binding → 非公開の保存Worker
                                                        ├ GitHub App Secret → 個人の1リポジトリ
                                                        └ R2 Binding → 自分の1バケット（写真の投稿に必要）
```

公開Workerは秘密鍵も保存権限も持ちません。保存Workerは公開Workerの自己申告を信頼せず、Cloudflareが署名した元のAccess JWTを独立して検証します。署名不正、期限切れ、別のAccessアプリ、許可されていないメール、異なるPOST Originは鍵を使う前に拒否します。

GitHubは固定した1リポジトリのContents write / Metadata readだけのinstallation tokenを要求し、永続保存・キャッシュしません。記事には更新用のSHAを渡さず、新規作成だけを行います。R2では外部へ渡せるAPIキーを使わずBindingを使い、画像を新規作成する条件を指定して上書きを防ぎます。

ただし保存WorkerはGitHub Appの秘密鍵を読み取れます。保存WorkerやCloudflareアカウントが侵害されれば鍵の流出や権限の悪用が可能です。GitHubのContents writeやR2 Binding自体はパス・新規作成だけに権限を制限するものではなく、制約を実施しているのは保存Workerのコードです。公開Workerの侵害時も、盗んだ有効なAccess JWTで許された新規投稿を悪用するリスクは残ります。

ブラウザ内の悪意あるコードは下書きを盗んだりログイン中の投稿を実行したりできます。エディタの配布コード、依存関係、利用者端末の安全性に関する責任は残ります。「責任ゼロ」や「鍵の取り出しが不可能」を保証する構成ではありません。

## 利用者が増えた場合

1,000人がそれぞれのアカウントで導入する場合、投稿処理、鍵、保存容量は各利用者のリソースに分散します。配布元の1つのWorkerやAccessアプリで1,000人を処理する構成ではありません。無料枠はそれぞれのアカウント内の他の利用分も含めて確認します。

配布元の案内サイトやコード配布のアクセス量は別に確認します。共通コードの脆弱性や危険な更新は複数の利用者に影響するため、分散しても配布コードの安全性は必要です。利用者が増えるほど導入・更新の案内も課題になります。1,000人での実測や、本番の無料CPU枠の検証はまだ行っていません。

## 無料で使う条件

有料KMSや有料プランを前提にしません。2026-10-08時点で[Workers Free](https://developers.cloudflare.com/workers/platform/pricing/)は1日100,000リクエスト、1呼び出し10msのCPU枠、[Zero Trust Free](https://www.cloudflare.com/plans/zero-trust-services/)は50ユーザーまでです。Service Bindingの呼び出しによる追加リクエスト料金はありません。

[R2 Standardの無料枠](https://developers.cloudflare.com/r2/pricing/)は毎月10GBの保存、Class A 100万回、Class B 1,000万回です。超過は課金され、アプリ側に課金停止機能はありません。画像の保存先はR2だけです。写真を投稿しない場合はR2を作成せず、設定例の `r2_buckets` を削除して記事だけ保存できます。GitHubにも記事保存の容量・API・ファイルサイズの制限があります。

無料枠内の本番CPU使用量は未検証です。Access JWT検証・GitHub JWT署名・画像処理が10ms枠に収まるか、実際の利用環境で確認します。独自ドメインを新しく購入する場合の費用は含みません。

## GitHub Appと保存先

1. 自分の個人アカウントでGitHub Appを作り、インストール先を自分のアカウントだけにします。Webhookは使用しません。
2. Repository permissionsをContents: Read and write、Metadata: Read-onlyにします。Organization permissionsやユーザーのOAuthログインは不要です。
3. Only select repositoriesで投稿先の1リポジトリにインストールします。対象のブランチは事前に作成しておきます。
4. App IDと秘密鍵を取得します。秘密鍵をエディタ、ソースコード、Git、ログへ貼り付けないでください。
5. 写真を投稿する場合は自分のR2 Standardバケットを作成し、画像を `images/UUID.jpg` で配信できる公開ベースURLも用意します。バケットは投稿画像専用にします。GitHubには記事のMarkdownだけを保存します。

GitHub App秘密鍵はそのAppのインストール全体に効くため、別用途のAppを共用せず、選択した1リポジトリへのインストールだけにします。Organizationのインストールは保存Workerが拒否します。ブランチ保護による拒否は保存失敗として扱い、回避しません。

## Worker設定とAccess

1. `worker/publisher.example.jsonc` を `worker/publisher.jsonc`、`worker/gateway.example.jsonc` を `worker/gateway.jsonc` へコピーします。実設定と `.dev.vars*` / `.env*` はGit対象外です。
2. 保存WorkerのGitHub App ID、個人アカウント名、リポジトリ、ブランチ、必要ならR2バケット名を置き換えます。Gatewayの `PUBLISHER` が保存Worker名を指すようにします。
3. エディタをHTTPSのサイトルートで配信し、その同じオリジンの `/posts*` と `/auth/login*` だけをGatewayへルーティングします。例: `editor.example.com/posts*` / `editor.example.com/auth/login*`。GatewayにStatic Assetsを付けず、エディタの静的配信とは別Workerにします。
4. GatewayのWorker設定からAccessを開き、**Protect this Worker behind Access → All traffic** にします。Zero Trust側でそのAccessアプリのAllowを自分のメールだけに絞ります。メールのワンタイムPINなどCloudflareで管理するログイン方式を使用します。EveryoneやBypassは設定しません。
5. そのAccessアプリのAudience（AUD）、チームURL（`https://your-team.cloudflareaccess.com`）、許可メールを両Workerの `ACCESS_AUD` / `ACCESS_ISSUER` / `ALLOWED_EMAILS` に設定します。`EDITOR_ORIGIN` は末尾のスラッシュなしのHTTPSオリジンで一致させます。複数メールはカンマ区切りです。
6. 保存Workerは `workers_dev: false` / `preview_urls: false` のまま、routes / Custom Domainを追加しません。Gatewayと保存Workerに別のAccessアプリが適用される構成は避けます。

Worker単位のAccessが重要です。Gatewayは `ctx.access.getIdentity()` を使用し、Accessを通っていない呼び出しでは保存Workerを呼びません。[Cloudflareの説明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)では、このコンテキストはService BindingやStatic Assetsの内部routerから伝わりません。そのため保存WorkerではJWTを再検証し、GatewayにはStatic Assetsを付けません。

設定例は公開ルートを含まず、そのままでは公開されません。Accessの作成とAUDの設定は実アカウントを使った導入時に行います。

## ログインを維持する設定

毎回の投稿でログインし直す必要はありません。再認証の頻度は、Workerの起動時間ではなく[Cloudflare Accessのセッション設定](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)で決まります。既定は24時間で、最大1か月まで設定できます。

自分の端末で長くログインを維持したい場合は、Zero TrustのAccess settingsでGlobal session duration、Gatewayを保護するAccessアプリでSession Durationを1か月に設定します。AllowポリシーのSession DurationはSame as applicationにし、短い期間で上書きされていないことも確認します。セッションが長いほど、盗まれた有効なセッションで投稿できる期間も長くなります。

期限切れ、ブラウザデータの削除、利用者のセッション失効などでは再ログインが必要です。GitHubの鍵やトークンをブラウザへ保存してログインを延長することはありません。端末を紛失した場合は、その利用者のAccessセッションを失効させます。

## 公開時に行う操作

次のコマンドは本番リソースを変更します。ローカル検証では実行しません。保存Workerを先に作成し、秘密鍵はそのWorkerだけへ登録します。

```sh
pnpm exec wrangler deploy --config worker/publisher.jsonc
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY --config worker/publisher.jsonc
pnpm exec wrangler deploy --config worker/gateway.jsonc
```

Secretの入力にはGitHub Appから取得したPEMを使用します。実装はGitHubのPKCS#1形式に対応します。初回導入時は公開ルート追加の前にAccess保護と両WorkerのAUDを設定し、最終設定を再デプロイします。Gatewayへ秘密鍵やR2 Bindingを登録しないでください。

エディタのWorker URLを `https://editor.example.com/posts` にし、設定の「投稿先にログイン（別タブ）」を開きます。Cloudflareの認証後、元のタブへ戻って「投稿」を押します。別タブでのログインが下書きを消すことはありません。認証が期限切れになった場合もログインし直してから手動で投稿します。バックグラウンド送信や自動再投稿はありません。

## 公開前の検証

ローカルでは型検査、ユニットテスト、ブラウザテストと両Workerのdry-runを行います。dry-runはバンドルの検証で、AccessログインやGitHub/R2への本番接続を検証しません。

実アカウントを使う導入時は、認証なし・許可メール外の投稿拒否、正しいログイン後の投稿、同日記事の409、画像の公開URL、設定先以外への保存拒否、無料CPU枠を確認します。iPhone Safariでの実機確認も残ります。

記事保存に失敗した場合の画像は、現在の実装案では残して同内容の再送で再利用します。自動削除の可否は公開前に決めます。通信中断後に保存できたか分からない場合は投稿先を確認し、盲目的に再送しないでください。

鍵の漏えいが疑われる場合は、そのGitHub Appの秘密鍵を失効させて再発行し、保存WorkerのSecretを入れ替えます。Cloudflare/GitHubのアカウントにはそれぞれの認証保護を適用し、公開Workerから保存WorkerのコードやSecretを変更できる運用権限を与えないでください。
