export type Language = 'ja' | 'en';

const ja = {
  navigation: '言語・使い方・設定', help: '使い方',
  helpWrite: '記事を書く', helpWriteBody: 'タイトルと本文を入力します。本文にはMarkdownを使えます。',
  helpPhoto: '写真を添える', helpPhotoBody: '本文の長押しか、「写真を追加」で挿入します。キャプションは任意です。',
  helpExport: 'コピーする・投稿する', helpExportBody: '「Markdownをコピー」でタイトルと日付を含む記事をコピーします。「投稿」は対応するWorkerを設定した場合に使えます。',
  helpSettings: '設定に入れるURL',
  helpPublicUrl: '画像を配信するベースURLです。R2なら接続した独自ドメインを入れます。',
  helpImagePath: 'images/画像名.jpg は自動で付けます。写真を使う場合に必要です。',
  helpWorkerUrl: '投稿用APIのURLです。対応するWorkerを用意して指定します。コピーだけなら空欄で使えます。',
  settings: '設定', close: '閉じる', title: 'タイトル', body: '本文', editor: '記事を書く',
  addPhoto: '写真を追加', choosePhoto: '写真を選ぶ', photoInput: '写真を選択',
  photoHint: '本文の長押しからも追加できます', photoCount: '{count}枚を準備済み',
  imageHint: '写真は長辺1920px以内のJPEGにします。',
  processing: '処理中…', copy: 'Markdownをコピー', post: '投稿',
  copied: 'Markdownをコピーしました。', posted: '投稿しました。',
  connectionPending: '投稿時に接続を確認します。', disconnected: '投稿先は未接続です。コピーは使えます。',
  insertHint: 'カーソル位置に写真を追加します。', caption: 'キャプション',
  captionLabel: '写真の説明（任意）', captionPlaceholder: '任意', insert: '本文に追加',
  imageStorage: '画像の保存先', publicUrl: '画像の公開URL', workerUrl: 'Worker URL',
  r2Hint: 'R2に接続した独自ドメインです。画像名は含めません。',
  githubHint: '画像を配信するサイトのURLです。画像名は含めません。',
  workerHint: '投稿用APIのURLです。コピーだけなら不要です。',
  sessionHint: '設定と記事はこの画面を開いている間だけ保持します。', apply: '設定を反映',
  invalidUrl: 'URLはhttpまたはhttpsで指定してください。認証情報・クエリ・フラグメントは含められません。',
  titleRequired: 'タイトルを入力してください。', publicUrlRequired: '写真付き記事をコピー・投稿するには設定で画像の公開URLを指定してください。',
  invalidDimensions: '写真の大きさを読み取れませんでした。', unreadablePhoto: 'この写真を読み込めません。HEICは対応するSafariで開くかJPEGを選んでください。',
  canvasUnavailable: 'このブラウザでは写真を縮小できません。', jpegFailed: '写真をJPEGへ変換できませんでした。',
  conflict: 'この日付の記事は既に存在します。上書きせず投稿を止めました。',
  unauthorized: '投稿先の認証・アクセス許可を確認してください。入力と写真は残っています。',
  saveFailed: '投稿先で処理に失敗しました。入力と写真は残っています。',
  workerRequired: '投稿先が未接続です。設定でWorker URLを指定してください。',
  invalidExistence: '投稿先の存在確認の応答が正しくありません。画像は送信していません。',
  unconfirmedSave: '記事の保存完了を確認できませんでした。投稿先を確認してください。入力と写真は残っています。',
  clipboardUnavailable: 'この環境ではコピーできません。HTTPSまたはlocalhostで開いてください。',
  operationFailed: '処理できませんでした。ブラウザの権限・投稿先の接続を確認してください。入力と写真は残っています。',
};

export type MessageKey = keyof typeof ja;
type Messages = Record<MessageKey, string>;

const en = {
  navigation: 'Language, help and settings', help: 'Help',
  helpWrite: 'Write your post', helpWriteBody: 'Enter a title and write the body. You can use Markdown formatting in the body.',
  helpPhoto: 'Add a photo', helpPhotoBody: 'Press and hold in the body or choose “Add photo” to insert a photo. The caption is optional.',
  helpExport: 'Copy or post', helpExportBody: '“Copy Markdown” copies your post with its title and date. “Post” is available when you configure a compatible Worker.',
  helpSettings: 'URLs in Settings',
  helpPublicUrl: 'The base URL that serves your images. For R2, use your connected custom domain.',
  helpImagePath: 'images/filename.jpg is appended automatically. Required for posts with photos.',
  helpWorkerUrl: 'Your posting API endpoint. Set up a compatible Worker to use it. Leave it empty if you only copy.',
  settings: 'Settings', close: 'Close', title: 'Title', body: 'Body', editor: 'Write a post',
  addPhoto: 'Add photo', choosePhoto: 'Choose photo', photoInput: 'Select photo',
  photoHint: 'You can also press and hold in the body', photoCount: '{count} photo(s) ready',
  imageHint: 'Photos are resized to JPEG with a maximum edge of 1920px.',
  processing: 'Processing…', copy: 'Copy Markdown', post: 'Post',
  copied: 'Markdown copied.', posted: 'Post saved.',
  connectionPending: 'The connection is checked when you post.', disconnected: 'No posting service connected. Copy is available.',
  insertHint: 'The photo will be inserted at the cursor.', caption: 'Caption',
  captionLabel: 'Photo description (optional)', captionPlaceholder: 'Optional', insert: 'Insert into body',
  imageStorage: 'Image storage', publicUrl: 'Public image URL', workerUrl: 'Worker URL',
  r2Hint: 'Your R2 custom domain without an image filename.',
  githubHint: 'Your image-serving site URL without an image filename.',
  workerHint: 'Your posting API endpoint. Not needed for copying.',
  sessionHint: 'Settings and your post are kept only while this page is open.', apply: 'Apply settings',
  invalidUrl: 'Enter an http or https URL without credentials, a query string or a fragment.',
  titleRequired: 'Enter a title.', publicUrlRequired: 'Set the public image URL in Settings before copying or posting an article with photos.',
  invalidDimensions: 'Could not read the photo dimensions.', unreadablePhoto: 'Could not read this photo. Open HEIC in a supported Safari browser or choose a JPEG.',
  canvasUnavailable: 'This browser cannot resize photos.', jpegFailed: 'Could not convert the photo to JPEG.',
  conflict: 'A post already exists for this date. Posting stopped without overwriting it.',
  unauthorized: 'Check the posting service’s authentication and permissions. Your text and photos are still here.',
  saveFailed: 'The posting service failed. Your text and photos are still here.',
  workerRequired: 'No posting service connected. Set the Worker URL in Settings.',
  invalidExistence: 'The posting service returned an invalid existence check. No images were sent.',
  unconfirmedSave: 'Could not confirm that the post was saved. Check the posting service. Your text and photos are still here.',
  clipboardUnavailable: 'Copy is unavailable here. Open the editor over HTTPS or on localhost.',
  operationFailed: 'The operation failed. Check browser permissions and the posting service connection. Your text and photos are still here.',
} satisfies Messages;

export const messages: Record<Language, Messages> = { ja, en };

export class EditorError extends Error {
  constructor(readonly key: MessageKey) {
    super(ja[key]);
    this.name = 'EditorError';
  }
}
