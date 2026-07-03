// ============================================================
// Google認証（Google Identity Services）と、
// drive.fileスコープでルートフォルダへのアクセス権を得るためのPicker連携
// ============================================================
const Auth = (() => {
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let pickerLoaded = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("スクリプト読み込みに失敗しました: " + src));
      document.head.appendChild(s);
    });
  }

  async function init() {
    await loadScript("https://accounts.google.com/gsi/client");
    await loadScript("https://apis.google.com/js/api.js");

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.OAUTH_SCOPE,
      callback: () => {}, // requestAccessToken() ごとに動的に上書きする
    });
  }

  function requestAccessToken(interactive) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(resp);
          return;
        }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000 - 60_000;
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });
  }

  // 補足：一時期「まずサイレント（prompt:''）で取得→失敗時のみ同意画面」という
  // 方式を試したが、iOS SafariのITP（トラッキング防止）環境下では、
  // サイレント取得の裏でGoogleが出すCookieアクセス確認ダイアログが
  // 1回目は許可できても2回目以降"Can't access your Google Account"という
  // 復帰不能なエラー画面になることを実機で確認したため撤回した。
  // ログインボタン押下時は常に通常の同意画面（prompt:'consent'）を出す、
  // という以前の確実な方式に戻している。
  async function signIn() {
    return requestAccessToken(true);
  }

  async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt) {
      return accessToken;
    }
    // トークン期限切れ・未取得時はサイレント再取得を試みる。
    // ブラウザ側のGoogleセッションが有効なら画面遷移なしで再取得できる場合が多い。
    return requestAccessToken(false).catch(() => requestAccessToken(true));
  }

  function isSignedIn() {
    return !!accessToken;
  }

  async function ensurePickerLoaded() {
    if (pickerLoaded) return;
    await new Promise((resolve, reject) => {
      gapi.load("picker", { callback: resolve, onerror: reject });
    });
    pickerLoaded = true;
  }

  // drive.fileスコープでは、アプリが作成していない既存フォルダにはアクセスできないため、
  // 初回のみPickerでユーザーに明示的にフォルダを選ばせてアクセス権を取得する。
  async function grantRootFolderAccessViaPicker() {
    await ensurePickerLoaded();
    const token = await getAccessToken();

    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(CONFIG.GOOGLE_API_KEY)
        .addView(view)
        .setTitle("アップロード先の共有フォルダを選択してください")
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs && data.docs[0];
            if (!doc) {
              reject(new Error("フォルダが選択されませんでした"));
              return;
            }
            if (doc.id !== CONFIG.ROOT_FOLDER_ID) {
              // 想定と異なるフォルダが選ばれた場合も一応許可はするが警告する
              console.warn(
                "選択されたフォルダIDが設定値と異なります。選択: " +
                  doc.id +
                  " / 設定値: " +
                  CONFIG.ROOT_FOLDER_ID
              );
            }
            resolve(doc);
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error("フォルダ選択がキャンセルされました"));
          }
        })
        .build();
      picker.setVisible(true);
    });
  }

  // ルートフォルダへ既にアクセスできるか（metadata取得を試みて判定）
  async function checkRootFolderAccess() {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${CONFIG.ROOT_FOLDER_ID}?fields=id,name`,
      { headers: { Authorization: "Bearer " + token } }
    );
    return res.ok;
  }

  // アクセス権が無ければPickerでの許可フローを行う。
  // この端末で一度許可済みであることをローカル（localStorage）に記録し、
  // 以後はDrive APIへの確認リクエストやPicker表示自体を毎回行わないようにする
  // （このフラグを見ずに毎回checkRootFolderAccess()を呼んでいたのが、
  // 毎回フォルダ選択が表示されてしまっていた原因）。
  async function ensureRootFolderAccess() {
    if (localStorage.getItem("rootFolderGranted") === "1") {
      return true;
    }
    const ok = await checkRootFolderAccess();
    if (ok) {
      localStorage.setItem("rootFolderGranted", "1");
      return true;
    }
    await grantRootFolderAccessViaPicker();
    localStorage.setItem("rootFolderGranted", "1");
    return true;
  }

  return {
    init,
    signIn,
    getAccessToken,
    isSignedIn,
    ensureRootFolderAccess,
    checkRootFolderAccess,
  };
})();

window.Auth = Auth;
