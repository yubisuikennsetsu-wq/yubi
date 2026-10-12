# 当日遅延ストーリー（2026-10-12）

実装・ローカル検証済み。本番反映・実投稿は未実施。

最新ユーザー指定：毎日11時を基本とし、間に合わないストーリーはその日の日本時間内だけ公開できる。翌日以降は11時のままとし、予定を連鎖的に移動しない。

## 動作

- 日付と11時の予約枠を維持する。当日11時以降は画面の「本日11時の遅延分として保存します」確認チェックで受付。APIではlateToday=trueが必要。
- 新規素材は既存のupload-mediaから登録する。同日の同種・同frameのslot一意制約を維持し、公開済み・取消済み・非表示取消済みの上書きや新規重複を拒否する。
- 当日の未処理draft/scheduledは同じID・日時・frameで素材を編集できる。updated照合必須。コンテナ作成済み、published、cancelled、failed、uncertain、preparing、processing、ready、publishingは再開・上書きしない。
- 通常の未来予約・翌日以降の11時・feed16時と90分制限は維持。ストーリーだけ、当日のscheduled/processing/readyを90分超でも処理する。
- 日本時間0時以降は前日ストーリーを新規保存・新規公開開始しない。Cron中の経過時間も再検査する。未処理の前日分はfailedにする。すでに開始した通信の結果不明は再送せず既存uncertainを維持する。
- 検品、所有者認証、Origin検証、公開処理の一回取得、複数枚順序、天気プレビューのフラグ・素材ハッシュ公開禁止を維持。
- 下書きは自動公開しない。すでに旧版がfailedにした予約を勝手に復活させない。

予約時刻の11時は基本枠であり、遅延時の実際の公開時刻ではない。既存5分Cronで登録→処理確認→公開と進むため、通常でも数回のCronを要する。日付直前の保存では当日公開が間に合わない場合がある。日付前に開始したInstagramリクエストの応答時刻は外部サービスに依存するが、日付越え後に前日分の公開APIを新たに開始しない。

## 検証

- Node24、npm test：88件成功。ネットワーク遮断のテスト用preload・SQLiteメモリDB・模擬fetchを使用。
- 本番コードを読み取ってsocial.mjsだけ差し替えた適用候補：67件成功。DM・worker・生成系・動画検査・依存ライブラリは本番のまま保持。
- オフラインChromium：390px画面、遅延確認なしで送信0件、確認後に11時枠を維持した保存、同日編集、既存天気保護・入替え・取消表示・連打防止を確認。全HTTP通信を模擬し、Instagramへ接続しない。
- 日付越えの保存拒否、公開claim途中での日付越え停止、前日分の各処理状態で送信0件、当日90分超の複数枚公開順序・一回性、公開結果不明の再送禁止、翌日11時維持を確認。
- Wrangler dry-run成功。既存本番は03aa9bfc-9210-4e67-be99-4dc735333f4fが100%、eyeMode/socialModeはactiveと読取り確認した。チェックアウトに関連する.agents/skillsはなかった。

## 本番への適用手順（未実施）

対象は既存Worker yubisui-work-dmと/socialの静的アセット。新規サービス、DB移行、権限・Secrets変更、Cron変更は不要。

1. 最新の本番版・ソースと対象予約状態を再取得し、上記版から変わっていないか確認。別変更があれば統合し直す。
2. npm ci後、wrangler deploy --dry-runでビルド。scripts/build-social-release.mjsに本番bundle・dry-run bundle・候補出力先を渡す。他モジュール差分があれば停止する。
3. mainを候補bundle、assets.directoryをチェックアウトのapp/publicへ向けた一時configで、wrangler versions upload --no-bundle --keep-vars。これはまだトラフィック切替ではない。
4. 旧新版のbindingsとscript_runtimeを比較し、既存値を維持できることを確認した上で承認された版をversions deployで100%に切り替える。
5. 配信コード完全一致、5分Cron、モード維持を読戻し確認。親ブラウザで/socialを再読み込みして実画面を確認する。今日の実投稿操作は親が担当し、検証投稿は行わない。

今回ローカル候補は/tmp/yubi-late-worker.mjs、一時configは/tmp/yubi-late-wrangler.jsonc。これらは環境限定でGitには含めない。再現用のbuild-social-release.mjsはGitに保存する。戻し先は上記直前版。ただし戻すと当日遅延対応も解除されるため、戻す前に当日遅延予約の状態を確認する。
