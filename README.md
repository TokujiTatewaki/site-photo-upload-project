# 現場写真アップロードアプリ

詳細仕様は [spec.md](../spec.md) を参照。

## 構成

```
index.html          メイン画面（ログイン/アップロード/履歴）
manifest.json        PWAマニフェスト
sw.js                 Service Worker（アプリ本体のみオフラインキャッシュ）
css/style.css
js/config.js          クライアントID・APIキー・ルートフォルダIDなどの設定値
js/db.js               IndexedDBラッパー（アップロードキュー・マスタデータキャッシュ）
js/auth.js             Google認証（OAuth）・Picker連携
js/drive.js            Google Drive APIラッパー（フォルダ作成・resumable upload等）
js/compress.js         HEIC変換・画像リサイズ圧縮
js/main.js             画面ロジック統合
icons/                 PWAアイコン
```

## GitHub Pagesへの公開手順

1. このフォルダの中身一式（`index.html`をリポジトリ直下に置く）を
   `https://github.com/TokujiTatewaki/site-photo-upload-project` にコミット・プッシュする。
2. GitHubリポジトリの **Settings → Pages** で、Source を「Deploy from a branch」、
   ブランチを `main`（または公開に使うブランチ）、フォルダを `/root` に設定する。
3. 数分後、`https://tokujitatewaki.github.io/site-photo-upload-project/` で公開される。
4. Google Cloud Console側のOAuthクライアントID設定（承認済みのJavaScript生成元）に、
   上記URLのオリジン（`https://tokujitatewaki.github.io`）が登録済みであることを確認する
   （spec.md 10章参照。設定済み）。

## 初回利用時の流れ（動作確認チェックリスト）

- [ ] スマートフォンでURLを開き、「Googleでログイン」をタップする
- [ ] 共有Googleアカウントでログインする
- [ ] Pickerが表示されたら、ルートフォルダ（spec.md記載の共有フォルダ）を選択する
- [ ] 顧客名・施工現場・施工年月を「その他（新規作成）」から登録できる
- [ ] 写真を複数選択し、「アップロード実行」で一括アップロードできる
- [ ] Googleドライブ上に `顧客名 > 施工現場` フォルダが作成され、
      `YYYYMM_顧客名_施工現場_連番.jpg` の形式でファイルが保存されている
- [ ] アップロード中に機内モードにするなどして通信を切断し、再接続後に自動で再開されることを確認する
- [ ] 「履歴」タブで、この端末の履歴と全体共有履歴の両方が確認できる
- [ ] ホーム画面に追加し、PWAとして起動できることを確認する

## 既知の制約・注意事項

- OAuth同意画面が「テスト」ステータスのままの場合、アクセストークンの有効期限が短く、
  約7日ごとに再ログインが必要になる（spec.md 10章参照）。継続利用する場合は
  Google側の審査（公開ステータスへの移行）を検討する。
- iOS Safariでアプリをバックグラウンドにする／画面をロックすると、
  アップロードが中断される場合がある。中断時はレジューム機能で再接続後に自動再開するが、
  アップロード中は画面を閉じないよう案内表示している。
- 共有履歴ファイル（`upload-history.json`）は読み込み→追記→書き込みの単純な方式のため、
  複数端末がほぼ同時に書き込むと稀に上書き競合が起きうる。件数が多くない社内利用を前提とした割り切り。
