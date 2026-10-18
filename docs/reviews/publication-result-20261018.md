# 公開成功の記録保持・読み取り照合（未デプロイ）

基点は9831e16（本番実装876a3b4＋反映記録）。診断時の本番はdcdf7c4a-2b74-45df-96d6-8fe3fed61577、配信コードSHA-256は7f5c8e43fc33a3637d9df366ed31071f87114d6536d5e3d0b970b584c28c0405。今回の作業では本番の記録変更・再送・デプロイを行っていない。

## 問題と変更

旧処理ではmedia_publishの成功、social_jobsの成功記録、social_eventsの監査記録を同じtry/catchで囲んでいた。監査INSERTだけが失敗しても、古いjobのnull値でmedia_id/publishedを消し、uncertainへ変更する。Metaの成功応答後に監査を失敗させるローカル検証で再現済み。ただし10/18の実障害が監査失敗か通信タイムアウトかは、元例外の記録がなく特定不能。

- 公開通信の例外処理を成功記録・監査・permalink取得から分離する。監査/permalinkの失敗で公開済みを取り消さない。
- 成功応答のmediaId/containerId/publishedAtを既存metaのsocialPublication:jobIdにも独立保存する。予備保存の失敗は本記録を妨げない。本記録の失敗時はID付きuncertainへの記録を試みる。DB応答喪失で本記録がすでに成功していればpublishedを降格しない。
- 成功記録はstatus=publishingかつ同containerの場合のみ更新。更新件数0では成功イベントを書かない。
- 全DB書込みが失敗した場合までIDの永続保存は保証できない。その場合もpublishingを再送せず、既存の期限監視でuncertainになる。
- 新規GET /api/social/publication-check?id=予約ID は既存所有者認証を利用する。変更対象はGETルーティングのみで、認証ロジック・権限・Secretsを変更しない。
- 照合は保存済みmedia ID（または同containerの成功控え）に対するMeta GET、対象containerのstatus_code取得だけ。成功ID一致またはPUBLISHEDならpublication=confirmedと証拠種別を返す。FINISHED/ERROR/EXPIRED、取得失敗、ID不一致はunknown。本文一致から投稿IDを推測しない。
- 照合はDB・状態・監査へ一切書き込まない。confirmedでも元のstatus=uncertainはそのまま返す。公開済みへの手動修復機能や自動再送は追加しない。新UIは追加しない。

## 検証

npm test：103件合格。追加7ケースで監査失敗、成功記録失敗、コミット後のDB応答喪失、予備記録失敗、本記録失敗時の控えからの照合、通信失敗/ID欠落、繰返しCronで送信1回、照合不能時のunknown、照合前後のDB一致、GETのみ、未認証/POST拒否を検証した。既存天気2枚の未完成ガード・順序・結果不明時停止、当日予約等も回帰合格。Wranglerのローカルdry-runビルドも成功。実Metaへの新API呼出し・本番画面操作・適用バンドルでの検証は未実施。

## 反映に進む場合の注意

今回はsocial.mjsに加えworker.mjsのGETルーティング2行も変更する。既存build-social-release.mjsはworker変更を拒否するため、そのガードを無条件解除しないこと。承認後に最新本番を読取り、social部分と当該ルート差分だけを適用して非関連コードを照合し、専用の単一モジュールディレクトリで配信候補を作る。静的アセット・DBスキーマ・Cron・認証設定の変更は不要。

今回のGETでは既存10/11・10/18記録を修復しない。証拠確認後に状態修復する場合は別の承認済み処理とする。
