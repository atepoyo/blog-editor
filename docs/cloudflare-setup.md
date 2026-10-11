# 自分のCloudflareで投稿する

利用者ごとにCloudflare・GitHubのリソースを用意します。エディタの配布元が利用者の秘密鍵を預かる構成にはしません。アカウント作成、Secret登録、リソース作成、デプロイはこのリポジトリのローカル検証とは別の操作です。

利用者が自分のGitHub App秘密鍵を自分の保存WorkerのSecretへ登録し、保管・失効・再発行、アカウントとアクセス権、利用料金を管理します。配布元には利用者のアカウントへの管理権限を渡しません。追加の鍵管理サービスやパスキーによる投稿承認は、この構成の前提にしません。

共通Editorは公開オリジンで配信し、投稿用の画面とAPIは利用者ごとの別オリジンでCloudflare Accessにより保護します。本文・写真の受け渡しにはブラウザーの `postMessage` を使い、URLや共通Editorのサーバーへ載せません。

## 構成と残る責任

```text
ブラウザ
  ├ 公開の共通Editor（編集・端末内保存）
  │     └ postMessage（本文・写真のBlob。URLや共通サーバーには載せない）
  └ 自分の投稿画面 https://publish.example.com/publish
        └ Access保護されたGateway（publish.example.com、全トラフィック）
              ├ POSTING_UI Service Binding → 静的な投稿画面
              └ PUBLISHER Service Binding → 非公開の保存Worker
                    ├ GitHub App Secret → 個人の1リポジトリ
                    ├ IMAGES R2 → 公開写真
                    └ DRAFTS R2 → 手動同期用の非公開下書き
```

Gatewayは秘密鍵も保存権限も持ちません。投稿画面はGatewayがAccess認証を確認した後にService Binding経由で配信します。Gateway自体にはStatic Assetsを設定しません。Accessの `ctx.access` は内部router経由では届かないためです。PublisherはGatewayの自己申告を信頼せず、Cloudflareが署名した元のAccess JWTを独立して検証します。署名不正、期限切れ、別のAccessアプリ、許可されていないメール、異なるPOST Originは鍵を使う前に拒否します。

GitHubは固定した1リポジトリのContents write / Metadata readだけのinstallation tokenを要求し、永続保存・キャッシュしません。記事には更新用のSHAを渡さず、新規作成だけを行います。R2では外部へ渡せるAPIキーを使わずBindingを使い、画像を新規作成する条件を指定して上書きを防ぎます。

ただし保存WorkerはGitHub Appの秘密鍵を読み取れます。保存WorkerやCloudflareアカウントが侵害されれば鍵の流出や権限の悪用が可能です。GitHubのContents writeやR2 Binding自体はパス・新規作成だけに権限を制限するものではなく、制約を実施しているのは保存Workerのコードです。公開Workerの侵害時も、盗んだ有効なAccess JWTで許された新規投稿を悪用するリスクは残ります。

ブラウザ内の悪意あるコードは下書きを盗んだりログイン中の投稿を実行したりできます。共通Editorの配信元にも、編集コードと依存関係、本文・写真を端末内で扱う処理、配布更新の安全性に関する責任が残ります。投稿画面を別オリジンにしても、共通Editorのコード配布元に対する信頼が不要になるわけではありません。「責任ゼロ」や「鍵の取り出しが不可能」を保証する構成ではありません。

## 利用者が増えた場合

投稿処理、鍵、保存容量は各利用者のリソースに分散します。共通Editorの配布元が投稿WorkerやAccessアプリを一括管理する構成ではありません。料金・上限は各利用者のアカウント内の他の利用分も含め、[Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[Zero Trust](https://www.cloudflare.com/plans/zero-trust-services/)、[R2](https://developers.cloudflare.com/r2/pricing/)の公式情報で確認してください。

配布元の案内サイトやコード配布のアクセス量は別に確認します。共通コードの脆弱性や危険な更新は利用者に影響するため、分散しても配布コードの安全性は必要です。本番の利用量やCPU枠は未検証です。

## 無料で使う条件

特定の有料KMSやプランを前提にしません。各サービスの現在の料金と上限を公式ページで確認し、アカウント全体の使用量も含めて判断してください。

R2の使用量に応じて料金が発生する場合があり、アプリ側に課金停止機能はありません。写真を投稿する場合は公開画像用の `IMAGES` と手動下書き同期用の非公開 `DRAFTS` を別バケットにします。GitHubにも記事保存の容量・API・ファイルサイズの制限があります。

本番CPU使用量は未検証です。Access JWT検証・GitHub JWT署名・画像処理が各プランの上限内に収まるか、導入環境で確認します。独自ドメインを新しく購入する場合の費用は含みません。

## GitHub Appと保存先

1. 自分の個人アカウントでGitHub Appを作り、インストール先を自分のアカウントだけにします。Webhookは使用しません。
2. Repository permissionsをContents: Read and write、Metadata: Read-onlyにします。Organization permissionsやユーザーのOAuthログインは不要です。
3. Only select repositoriesで投稿先の1リポジトリにインストールします。対象のブランチは事前に作成しておきます。
4. App IDと秘密鍵を取得します。秘密鍵をエディタ、ソースコード、Git、ログへ貼り付けないでください。
5. 写真を投稿する場合は公開画像用のR2バケットを作成し、画像を `images/UUID.jpg` で配信できる公開ベースURLも用意します。手動下書き同期を使う場合は、別に公開設定をしない `DRAFTS` 用バケットも作成します。GitHubには記事のMarkdownだけを保存します。

GitHub App秘密鍵はそのAppのインストール全体に効くため、別用途のAppを共用せず、選択した1リポジトリへのインストールだけにします。Organizationのインストールは保存Workerが拒否します。ブランチ保護による拒否は保存失敗として扱い、回避しません。

## Worker設定とAccess

1. `worker/editor.example.jsonc`、`worker/gateway.example.jsonc`、`worker/posting-ui.example.jsonc`、`worker/publisher.example.jsonc` を、それぞれ同じ名前から `.example` を外した実設定ファイルへコピーします。実設定と `.dev.vars*` / `.env*` はGit対象外です。
2. Publisherに個人のGitHub App ID、固定するowner/repository/branch、および利用するR2バケット名を設定します。GitHub保存先は `GITHUB_*` 設定で固定し、リクエストから変更できません。
3. GatewayのService Bindingsを `PUBLISHER` と `POSTING_UI` に設定します。`POSTING_UI` は `dist/` の `publish.html` とassetsを配信する静的Workerです。`worker/posting-ui.example.jsonc` は `workers_dev: false` / `preview_urls: false` で公開routeを持たず、Static Assetsの `binding` も設定しません。GatewayからのService Bindingだけで利用します。
4. 共通Editorは公開HTTPS originで配信します。`worker/editor.example.jsonc` は `dist/` を配信する [Workers Static Assets](https://developers.cloudflare.com/workers/wrangler/configuration/#assets) 専用で、投稿WorkerやPublisherへのBinding、秘密鍵、R2 Bindingを持ちません。
5. Gatewayの `COMMON_EDITOR_ORIGIN` には共通EditorのHTTPS origin（例: `https://editor.example.com`）を設定します。既存の `EDITOR_ORIGIN` は歴史的な名前のまま、GatewayとPublisherの両方に各利用者の投稿画面origin（例: `https://publish.example.com`）を設定します。末尾のスラッシュは付けず、両Workerで一致させます。
6. 投稿画面URLを `https://publish.example.com/publish` にします。GatewayのCustom Domainを `publish.example.com` に設定し、Gateway Worker全体に **Protect this Worker behind Access → All traffic** を適用します。Zero Trust側のAllowは利用者本人のメールに絞り、EveryoneやBypassは設定しません。
7. Access applicationのAudience（AUD）、チームURL（`https://your-team.cloudflareaccess.com`）、許可メールをGatewayとPublisherの `ACCESS_AUD` / `ACCESS_ISSUER` / `ALLOWED_EMAILS` に設定します。Gatewayは `ctx.access.getIdentity()` を確認し、Publisherは元のCloudflare Access JWTを独立して検証します。保存Workerに公開route、workers.dev、preview URLを追加せず、別のAccess applicationを適用しません。

GatewayはAccess認証後に `/publish` と `/assets/*` を `POSTING_UI` Service Bindingへ渡し、`/posts` を `PUBLISHER` へ渡します。Gateway自体にStatic Assetsを設定しません。[Cloudflareの説明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)のとおり、Access contextはService BindingやStatic Assetsの内部routerから伝わらないためです。Gatewayが認証済み利用者を確認した後で静的投稿画面を配信し、PublisherでもJWTを検証します。

投稿画面はAccessログイン後に `/posts?destination=1` で固定されたowner、repository、branchを取得します。ログインが必要な場合は最大2分、Editorが送信準備完了を待ちます。認証待ちのタイムアウト、タブを閉じた場合、ポップアップ拒否、COOPによる`opener`切断では記事・写真を送らず、Editorの下書きを保持します。認証後にEditorから手動で投稿をやり直してください。投稿画面は受け取った内容をメモリだけに保持するため、再読み込みした場合はEditorから再送します。

設定例は本番routeを追加せず、デプロイだけでは利用者の投稿先として公開されません。Accessの作成とAUDの設定は導入時に行います。

## Accessセッション

再認証の頻度は[Cloudflare Accessのセッション設定](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)に従います。設定は現在の利用要件に合わせて管理し、セッションが長いほど盗まれた有効なセッションで投稿できる期間も長くなる点を考慮してください。GitHubの鍵やtokenをブラウザーへ保存してログインを延長することはありません。端末を紛失した場合は、その利用者のAccess sessionを失効させます。

## 公開時に行う操作

投稿Workerの次のコマンドは本番リソースを変更します。ローカル検証では実行しません。Publisherを先に作成し、秘密鍵はそのWorkerだけへ登録します。

### 共通Editorの自動デプロイ

`.github/workflows/deploy-editor.yml` は既定ブランチにEditorのビルド入力がPushされたとき、`worker/editor.production.jsonc` を使って公開Editorだけをビルド・デプロイします。初回の前に、GitHubリポジトリの **Settings → Secrets and variables → Actions** に次のSecretを登録します。

- `CLOUDFLARE_ACCOUNT_ID`: 共通Editorを配信するCloudflareアカウントのID
- `CLOUDFLARE_API_TOKEN`: そのアカウントでWorkerをデプロイする権限に絞ったAPI Token

このTokenはGitHub App秘密鍵やPublisherのSecretとは別物です。投稿Worker・Access・R2はこのworkflowから変更しません。公開ドメイン `editor.atepoyo.com` は `worker/editor.production.jsonc` で共通Editor Workerに割り当てます。

Wranglerの認証状態は `pnpm exec wrangler whoami` で確認します。未ログインの場合は `pnpm exec wrangler login` の認証を自分で完了します。認証情報をチャットや設定ファイルへ貼り付ける必要はありません。

```sh
pnpm build
pnpm exec wrangler deploy --config worker/publisher.jsonc
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY --config worker/publisher.jsonc
pnpm exec wrangler deploy --config worker/posting-ui.jsonc
pnpm exec wrangler deploy --config worker/gateway.jsonc
```

初回はGatewayのCustom Domainを付ける前にAccessを設定してAUDを取得します。GatewayとPublisherの設定値を埋め、Gatewayに `PUBLISHER` と `POSTING_UI` のService Bindingを設定して再デプロイします。画像用の公開ドメインは `IMAGES` R2へ接続します。手動同期を使う場合は非公開 `DRAFTS` R2もPublisherにBindingします。

共通EditorをこのCloudflareアカウントから配信する場合は、ビルド後に公開の静的配信Workerへデプロイします。Editorの設定例には投稿Bindingを追加しません。

```sh
pnpm build
pnpm exec wrangler deploy --config worker/editor.jsonc
```

GatewayのCustom Domainを `publish.example.com` に設定します。Gatewayはこのorigin全体を受け、`/publish`、`/assets/*`、`/posts` を振り分けます。共通Editorのoriginは別の公開HTTPS originです。

Secretの入力にはGitHub Appから取得したPEMを使用します。初回導入時はGatewayのCustom Domainを有効にする前にAccess保護と両WorkerのAUDを設定し、最終設定を再デプロイします。Gatewayへ秘密鍵やR2 Bindingを登録しないでください。

共通Editorで公開画像URLと自分の投稿画面URL（例: `https://publish.example.com/publish`）を設定します。**Post**を押すとポップアップを開き、Access認証後に投稿画面がGitHubリポジトリとレンダリングした記事プレビューを表示します。本人が「投稿を確定」を押した後にだけ、同じoriginの `GET /posts?path=...` とmultipart `POST /posts` を送ります。Editorは受け渡しreceiptだけを受け取り、投稿成功結果や認証情報は受け取りません。投稿完了後もEditorの下書きは維持します。

端末間で下書きを移すときは、両方の端末で同じ投稿用URL、Publisher、非公開 `DRAFTS` バケットを使います。Editorの「クラウドに保存」「クラウドから取得」から直接通信します。Gatewayの `COMMON_EDITOR_ORIGIN` に共通Editorのoriginを指定します。認証が必要な場合は設定の認証ボタンからログインします。自動fetchや別の投稿環境の探索・共有はしません。空または同じ内容の端末にはそのまま取り込み、異なる内容は両方を保って明示選択で解決します。

## 公開前の検証

ローカルでは型検査、ユニットテスト、ブラウザテストとEditor・Gateway・投稿画面・Publisherのdry-runを行います。各dry-runは `pnpm build` の後に対応する `worker/*.example.jsonc` で行います。dry-runは配信ファイル・バンドルの検証で、AccessログインやGitHub/R2への本番接続を検証しません。

本番環境は未検証です。Accessの許可外拒否、本人認証後の投稿画面表示、手動下書き同期、同日記事の409、画像の公開URL、設定先以外への保存拒否を導入環境で確認します。iPhone Safariも未検証です。

記事保存に失敗した場合の画像は、現在の実装案では残して同内容の再送で再利用します。自動削除の可否は公開前に決めます。通信中断後に保存できたか分からない場合は投稿先を確認し、盲目的に再送しないでください。

鍵の漏えいが疑われる場合は、そのGitHub Appの秘密鍵を失効させて再発行し、保存WorkerのSecretを入れ替えます。Cloudflare/GitHubのアカウントにはそれぞれの認証保護を適用し、公開Workerから保存WorkerのコードやSecretを変更できる運用権限を与えないでください。
