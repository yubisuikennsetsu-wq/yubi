# セットアップと運用手順

## ローカル／クラウド開発環境
Node.js 24（node:sqliteを使用）。最初に `npm install` で開発依存を入れ、生成されたpackage-lock.jsonを管理する。以後は `npm ci`。テストは `npm test`。テストは模擬DB・模擬APIで行い実在ユーザーへ送信しない。

Wranglerは引継ぎ時に使用した4.143.0を固定。バージョン変更は検証してから。

## 既存本番へ接続する場合
本番はすでに稼働中。最初にread-onlyで契約、Worker版、DB構成、予約、eye状態を確認する。DBの初期化やスキーマの一括再適用はしない。

クラウド実行環境のSecretsに `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を管理者が登録する。必要最小限のWorker更新・対象D1操作権限とする。ローカルOAuthやWindowsキーリングはコピーしない。GitHub等のCIにデプロイを付ける場合は保護された本番環境を用い、未信頼PRにSecretsを渡さない。

検証後のデプロイ：`npm run deploy`。既存Workers Secretsは通常のデプロイで維持される。接続先が既存本番であることを確認してから実行する。デプロイ成功とDM送信成功は別。

## Workers Secrets・設定名（値は配布しない）
- APP_ORIGIN：既存本番HTTPSオリジン
- OWNER_PASSWORD：アプリ専用所有者パスワード
- IG_ACCOUNT_ID、IG_ACCESS_TOKEN：会社Instagram接続
- META_APP_SECRET、META_VERIFY_TOKEN：Webhook署名・検証
- DATA_ENCRYPTION_KEY：既存AES-256-GCM鍵。変更すると既存データが読めない
- VAPID_JWK、VAPID_SUBJECT：既存Push鍵・連絡先。鍵を勝手に交換しない
- TEST_NOTIFY_FROM／TEST_NOTIFY_UNTIL：期限付きテスト用。通常稼働で延長しない

APP_ORIGINやID等は構成値だが、既存配置がSecretsならそのまま尊重する。cloud AI binding、D1、assets、browser bindingはwrangler.jsoncを参照。新しい本番へのWebhookの切替は、並行送信・Push・データ移行を検討する別作業である。

## 新規の隔離検証環境
本番のWorker名・DB IDを使わず、別構成・別DBを用意する。実Instagramトークンや本番Push購読を入れない。SQLファイルは番号付きmigration体系ではないため、`wrangler d1 migrations apply` を盲目的に実行しない。schema.sql → replies.sql → social.sql → autopilot.sql → eye.sql の内容と依存を検査して、空の検証DBへ適用する。CREATE IF NOT EXISTSは将来の列変更を自動適用するものではない。

## 管理APIの移植
既存の所有者ログインはPOST /api/login、本文 {password}、OriginはAPP_ORIGIN。発行Cookieをメモリだけで保持し、作業後POST /api/logout。管理POSTにはOrigin・Cookie・JSONを付ける。パスワードをブラウザJSや公開設定へ入れない。

- GET /api/social/status：既存枠・状態の取得
- GET /api/social/preflight：公開前確認
- POST /api/social/analyze：反応取得（実装・権限を確認）
- POST /api/social/queue：{kind,category,caption,due,jpeg,checked,frame,hold}。dueはミリ秒、jpegはJPEG Base64。詳細の検証はsocial.mjsを正とする
- POST /api/social/edit：既存idを指定。取消・公開済み枠を尊重
- GET /api/eye/status：会話・送信状態。個人情報をCIログへ出力しない
- GET /api/eye/notice：要対応の有無
- POST /api/eye/step：実返信を実行し得る。疎通テストには使わない
- POST /api/eye/test：送信せずAI案を作るが無料枠を消費する。架空データのみ

## クラウド化の完了条件
1. スケジューラーはJST日曜9時（UTC日曜0時）。既存PC側タスクを調べ、担当が重複しない切替手順を作る。
2. 画像生成ツールが対象のクラウド環境で使えること、費用と品質を確認。未提供なら制作の無人化は未完了。低品質の代替で埋めない。
3. 週次制作の最初は月曜11時・16時枠。画像・本文・日時が24時間前までに/socialで表示されることを確認する。
4. 予約直前にも既存枠を再確認。公開結果uncertainは実物を照合し、再投稿しない。
5. 日曜天気は前日完成・当日朝更新。未発表の未来値を作らない。取消された旧2・3枚目は復活させない。
6. 本番でWebhook・返信・通知・予約公開の確認を分けて記録。UIで「送信成功」を偽らない。
7. クラウド制作が動いたことを確認してからPC側の重複スケジュールを停止する。停止は移行対象だけ。

## 引継ぎに含めないもの
元work/全体、キーリング、.env、.dev.vars、.wrangler、node_modules、認証Cookie、DB/SQLダンプ、eye-last-result.json、DMスクリーンショット、実利用者の会話。既存予約の画像等が必要なら公開可能な素材だけ別途選別する。

元の outputs/dm-notify/README.md は導入初期の説明が混在しているため本パッケージに含めない。仕様の最新指示はAGENTS.md、実装の事実はソースと本番の観測を優先する。
