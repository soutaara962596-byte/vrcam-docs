# Human Relay Reduction接続

## 観測済み状態

既存HRR Completion Sprintは投入ZIPが作成済みで、今回の確認対象からは統合Sprintの完了は確認できていません。共有rootには既存 `tools/intake.py` があり、`return/<actor>/<TaskId>/RETURN_READY.json` の完成markerとfiles配列を読み、候補ledgerを生成します。

Registryは既存Phase Aの10状態を保持します。本文の「公開済み」「承認済み」や機械検証だけを、Authority / ACCEPTED / Formal PASSに昇格しません。CURRENT HANDOFFの現行baseも今回bindできていません。

## 実装した接続口

```sh
python integration/prepare_return.py --out .state/return/codex/DOCS_PILOT_001 --task DOCS_PILOT_001 --actor codex
```

再build → 公開対象/生成物検証 → Markdown + selection + report + RESULT + manifestを1 ZIP化 → ZIP CRC・readback → 外側SHA/長さ/entry数 → READY-lastの順で出力します。既存の出力先は上書きせず、新attemptを使います。途中失敗の一時directoryには運用可能な返却名を付けません。

生成物:

- `docs-review.zip`: 1 task = 1 ZIPの公開候補
- `ZIP_VERIFICATION.json`: outer identityと検証記録
- `RETURN_READY.json`: 既存intake互換marker、全payloadのexact files配列

`--out` はローカルcandidate領域を既定運用とし、共有rootへの配置時は既存actor / task / attempt対応と期待するZIP identityをHRR owner側でbindします。markerのtask名だけを信頼しません。既存intakeはZIP内部の厳密な検証器ではないので、HRR側の独立期待値にbindしたvalidatorを通す必要があります。

既存intake実コードとの試験は `HRR_INTAKE_SOURCE` 環境変数で読取り元を指定できます。試験ではROOT / RETURN / INTAKE / TESTOUTをtemporary fixtureへ差し替え、既存の実ファイルやledgerには書き込みません。取り込み・再試行・改変拒否を検証します。CIにはこのローカル実装がないため、その1件のみ明示SKIPし、portable ZIP/marker試験を実行します。

## 状態対応と責任分界

| このpilotの証拠 | HRR側での扱い |
|---|---|
| 公開対象検証成功 | LOCAL_VALIDATED_CANDIDATE。公開承認ではない |
| docs-review.zip + outer identity | Task/Actor/Attempt期待値との照合対象 |
| intakerの候補ledger | canonicalへの反映候補。Transportの正式REVIEW_READYとは別 |
| PR URL / head SHA / GitHub review | ドキュメント公開のレビュー証跡。製品acceptanceには流用しない |
| main SHA / Action run / Worker version / URL検査 | 公開deliveryの外部witness。実行した場合のみ記録 |

Registryへの反映はHRR ownerが既存APIを使い、ISSUEDと実返却のwitnessを確認してRETURNEDへ進めます。pilot自身はRegistry store / AuthorityRefを生成・上書きせず、Conversation Relayへ自動送信しません。既存のprepare/emit境界に、このZIP参照と短いPRレビュー依頼を渡せます。実配送provider、CURRENT HANDOFF現行base、正式accepted stateとの接続は未bindです。

## 将来の選択公開

CURRENT HANDOFF / ADR / Release Notes / FAQの原本を直接build globの対象にしません。公開用要約を `authoring/public/` に作り、明示selectionとHuman PR reviewに通します。元資料identityやapproval refは内部HRR記録に保持し、公開HTMLへ含めません。

本pilotの内部状態をCURRENT HANDOFFへ追記する場合の候補文:

> Documentation / Knowledge Publication pilotのローカル実装・試験を実施。docsは製品本体と独立。公開候補ZIPの既存intake互換接続を検証。GitHub repo設定・Human review・Cloudflare実公開・実rollbackは別途witnessが必要。現行HANDOFF base未bindのため、この記録は追記候補。
