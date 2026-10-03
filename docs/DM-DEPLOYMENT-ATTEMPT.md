# DM単独反映の検証と停止理由（2026-10-04 JST）

ユーザーから本番反映の指示を受け、main `4f0d596` から `fix/dm-calm-20261004` を分離した。動画・再予約変更、投稿素材、DBデータ、秘密情報は含めない。

## 検証

- DM専用ソースで59件成功。
- 現在デプロイ済みのWorkerソースをCloudflare正規APIで取得し、ソース内に作業環境の認証値がないことをチェックした。
- mainのビルドと既存本番で、social・studio・autopilot・composer・worker本体のアプリコードが一致した。一方、依存パッケージのバンドル方法に環境差があったため、既存本番の非DM部分を保持する組立スクリプトを追加した。
- 生成した本番用bundleでもDMテスト34件成功。Wrangler no-bundle dry-runも成功。
- 公開素材のソース差分はDM用の `reply-text.mjs` のみ。

## 反映結果：未反映

既存環境の認証で `wrangler versions upload --no-bundle --keep-vars` を実行したが、`/workers/scripts/yubisui-work-dm/assets-upload-session` が **No access to the specified resource** を返した。素材アップロードの開始段階で停止し、バージョンの本番切替は実行していない。

直後の読み取りで最新versionは45、`b90e24ae-d516-4967-8f35-a2192d995130` が100%のままと確認。新versionは作成されていない。5分Cronも既存設定のまま。DMや投稿の試験送信、DB書込み、Secrets変更、権限追加、認証回避はしていない。

## 再開に必要なこと

既存Workerとその静的素材をデプロイ可能な、正式に許可された接続が必要。現在の認証には対象素材アップロードへのアクセスがない。権限拡大や新しい永続認証が必要な場合はユーザーの確認を得る。秘密値をチャットに貼り付けてもらわず、承認後に環境のSecrets管理から設定する。別APIやDB直接更新で拒否を迂回しない。

アプリのHTTP 403とは別の問題。アプリ403の原因は未確定なので、パスワードの変更やアクセス制御解除を解決策として断定しない。所有者本人の通常ブラウザで既存URLへ接続できるかを確認するのが最小の切り分けとなる。

## 次の適用とロールバック

1. 本番versionとmainを再取得し、未検証の動画・再予約が混入していないDM専用ブランチを使用する。
2. ソース59件のテスト、バンドル差分、配信bundleのDM34件テストを再確認する。
3. `scripts/build-dm-release.mjs` に取得済み本番bundle・DMビルド・出力先を渡す。非DMコードが違えば停止する。生成bundleはGitへ追加しない。
4. 検証済みbundleを `versions upload --no-bundle --keep-vars` で登録し、登録成功後に設定・素材差分を確認してから新versionを100%へ切り替える。DB移行は不要。
5. 公開version、Cron、bindings、eyeMode・停止状態を読み取り検証。`/api/eye/step` は使わず実ユーザーへの試験DMを送らない。
6. 不具合時は、Cloudflareの既存バージョン切替機能で直前の `b90e24ae-d516-4967-8f35-a2192d995130` へ戻す。今回DB変更はない。人確認・手動停止のデータを自動再開させない。適用時に別versionへ更新済みなら、その直前versionを戻し先にする。

Cloudflareの戻し方：[Workers Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。戻し先は確認済みだが、実際のロールバック実行はしていない。
