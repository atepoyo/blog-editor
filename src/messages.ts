export type Language = 'ja' | 'en';

const ja = {
  navigation: '言語・使い方・設定', help: '使い方',
  helpWrite: '記事を書く', helpWriteBody: 'タイトルと本文を入力します。本文にはMarkdownを使えます。',
  helpPhoto: '写真を添える', helpPhotoBody: '本文の長押しか、「写真を追加」で挿入します。キャプションは任意です。',
  helpPost: '投稿する', helpPostBody: 'Worker URLを設定し、「投稿」でタイトルと日付を含む記事を保存します。写真はR2に保存します。',
  helpSettings: '設定に入れるURL',
  helpPublicUrl: 'R2の画像を配信するベースURLです。接続した独自ドメインを入れます。',
  helpImagePath: 'images/画像名.jpg は自動で付けます。写真を使う場合に必要です。',
  helpWorkerUrl: '自分の投稿用APIのURLです。投稿する前に設定します。未設定でも記事の編集と下書き保存は使えます。',
  settings: '設定', close: '閉じる', title: 'タイトル', body: '本文', editor: '記事を書く',
  addPhoto: '写真を追加', choosePhoto: '写真を選ぶ', photoInput: '写真を選択',
  photoHint: '本文の長押しからも追加できます', photoCount: '{count}枚を準備済み',
  imageHint: '写真は長辺1920px以内のJPEGにします。',
  processing: '処理中…', post: '投稿',
  posted: '投稿しました。',
  connectionPending: '投稿時に接続を確認します。', disconnected: '投稿先は未接続です。設定でWorker URLを指定してください。',
  insertHint: 'カーソル位置に写真を追加します。', caption: 'キャプション',
  captionLabel: '写真の説明（任意）', captionPlaceholder: '任意', insert: '本文に追加',
  publicUrl: '画像の公開URL', workerUrl: 'Worker URL',
  r2Hint: 'R2に接続した独自ドメインです。画像名は含めません。',
  workerHint: '投稿用APIのURLです。投稿する前に設定してください。',
  signIn: '投稿先にログイン（別タブ）',
  sessionHint: '記事・写真・設定はこのブラウザに保存します。', apply: '設定を反映',
  draftLoading: '下書きを読み込み中…', draftSaving: '下書きを保存中…', draftSaved: '下書きはこのブラウザに保存済みです。',
  draftReadFailed: '下書きを読み込めませんでした。保存済みのデータを保護するため自動保存を停止しています。',
  draftSaveFailed: '下書きを保存できませんでした。入力と写真は画面に残っています。保存が復旧するまで画面を閉じたり再読み込みしたりしないでください。',
  offlinePreparing: 'オフライン用の画面を準備中…', offlineReady: 'オフラインでも開けます。',
  offlineFailed: 'オフライン用の画面を準備できませんでした。オンラインで開き直してください。',
  offlinePost: 'オフラインでは投稿できません。接続後に「投稿」を押してください。',
  invalidUrl: 'URLはhttpまたはhttpsで指定してください。認証情報・クエリ・フラグメントは含められません。',
  titleRequired: 'タイトルを入力してください。', publicUrlRequired: '写真付き記事を投稿するには設定でR2の画像の公開URLを指定してください。',
  invalidDimensions: '写真の大きさを読み取れませんでした。', unreadablePhoto: 'この写真を読み込めません。HEICは対応するSafariで開くかJPEGを選んでください。',
  canvasUnavailable: 'このブラウザでは写真を縮小できません。', jpegFailed: '写真をJPEGへ変換できませんでした。',
  conflict: 'この日付の記事は既に存在します。上書きせず投稿を止めました。',
  unauthorized: '投稿先の認証・アクセス許可を確認してください。入力と写真は残っています。',
  saveFailed: '投稿先で処理に失敗しました。入力と写真は残っています。',
  workerRequired: '投稿先が未接続です。設定でWorker URLを指定してください。',
  invalidExistence: '投稿先の存在確認の応答が正しくありません。画像は送信していません。',
  unconfirmedSave: '記事の保存完了を確認できませんでした。投稿先を確認してください。入力と写真は残っています。',
  operationFailed: '処理できませんでした。ブラウザの権限・投稿先の接続を確認してください。入力と写真は残っています。',
};

export type MessageKey = keyof typeof ja;
type Messages = Record<MessageKey, string>;

const en = {
  navigation: 'Language, help and settings', help: 'Help',
  helpWrite: 'Write your post', helpWriteBody: 'Enter a title and write the body. You can use Markdown formatting in the body.',
  helpPhoto: 'Add a photo', helpPhotoBody: 'Press and hold in the body or choose “Add photo” to insert a photo. The caption is optional.',
  helpPost: 'Post your article', helpPostBody: 'Configure your Worker URL and choose “Post” to save the article with its title and date. Photos are saved to R2.',
  helpSettings: 'URLs in Settings',
  helpPublicUrl: 'The base URL that serves your R2 images. Use your connected custom domain.',
  helpImagePath: 'images/filename.jpg is appended automatically. Required for posts with photos.',
  helpWorkerUrl: 'Your posting API endpoint. Set it before posting. You can edit and save drafts without it.',
  settings: 'Settings', close: 'Close', title: 'Title', body: 'Body', editor: 'Write a post',
  addPhoto: 'Add photo', choosePhoto: 'Choose photo', photoInput: 'Select photo',
  photoHint: 'You can also press and hold in the body', photoCount: '{count} photo(s) ready',
  imageHint: 'Photos are resized to JPEG with a maximum edge of 1920px.',
  processing: 'Processing…', post: 'Post',
  posted: 'Post saved.',
  connectionPending: 'The connection is checked when you post.', disconnected: 'No posting service connected. Set the Worker URL in Settings.',
  insertHint: 'The photo will be inserted at the cursor.', caption: 'Caption',
  captionLabel: 'Photo description (optional)', captionPlaceholder: 'Optional', insert: 'Insert into body',
  publicUrl: 'Public image URL', workerUrl: 'Worker URL',
  r2Hint: 'Your R2 custom domain without an image filename.',
  workerHint: 'Your posting API endpoint. Set it before posting.',
  signIn: 'Sign in to post (new tab)',
  sessionHint: 'Your post, photos and settings are saved in this browser.', apply: 'Apply settings',
  draftLoading: 'Loading draft…', draftSaving: 'Saving draft…', draftSaved: 'Draft saved in this browser.',
  draftReadFailed: 'Could not load the draft. Automatic saving is paused to protect the saved data.',
  draftSaveFailed: 'Could not save the draft. Your text and photos are still on screen. Do not close or reload this page until saving works again.',
  offlinePreparing: 'Preparing the editor for offline use…', offlineReady: 'Ready to open offline.',
  offlineFailed: 'Could not prepare the editor for offline use. Reopen it while online.',
  offlinePost: 'Posting is unavailable offline. Reconnect and press Post.',
  invalidUrl: 'Enter an http or https URL without credentials, a query string or a fragment.',
  titleRequired: 'Enter a title.', publicUrlRequired: 'Set the public R2 image URL in Settings before posting an article with photos.',
  invalidDimensions: 'Could not read the photo dimensions.', unreadablePhoto: 'Could not read this photo. Open HEIC in a supported Safari browser or choose a JPEG.',
  canvasUnavailable: 'This browser cannot resize photos.', jpegFailed: 'Could not convert the photo to JPEG.',
  conflict: 'A post already exists for this date. Posting stopped without overwriting it.',
  unauthorized: 'Check the posting service’s authentication and permissions. Your text and photos are still here.',
  saveFailed: 'The posting service failed. Your text and photos are still here.',
  workerRequired: 'No posting service connected. Set the Worker URL in Settings.',
  invalidExistence: 'The posting service returned an invalid existence check. No images were sent.',
  unconfirmedSave: 'Could not confirm that the post was saved. Check the posting service. Your text and photos are still here.',
  operationFailed: 'The operation failed. Check browser permissions and the posting service connection. Your text and photos are still here.',
} satisfies Messages;

export const messages: Record<Language, Messages> = { ja, en };

export class EditorError extends Error {
  constructor(readonly key: MessageKey) {
    super(ja[key]);
    this.name = 'EditorError';
  }
}
