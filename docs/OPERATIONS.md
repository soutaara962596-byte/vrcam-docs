# 公開基盤の運用手順

## 初期登録とHuman review

このpilotを空の**非公開docs専用repo**へ登録します。既存製品repoのmainへ直接コピーしません。初期mainにはREADMEのみを置き、pilotのファイル一式は実装branchからdraft PRにしてください。初回のmainにはproduction workflowが存在しないため、以下の設定とレビューを終えるまでデプロイされません。

`scripts/pr.mjs` は通常の記事更新用です。初回のコード導入PRはGit/GitHub CLIで全ファイルを対象に作成します。

PR author / 最後のpushをしたactorと、承認者は別のGitHub identityを使います。AIが人間本人のアカウントでPR作成すると、その本人は自分のPRをapproveできません。専用GitHub App / botをPR authorにするか、別の権限を持つ人にレビューを依頼します。CIのGITHUB_TOKENにPR承認権限は付与しません。

PR作成actorの権限はdocs repoだけに限定した Contents read/write と Pull requests read/write。通常の記事更新にActions・Secrets・Administrationの編集権限は不要です。初回workflow登録は人間の管理セッションで行います。

## GitHub protection

`CODEOWNERS` は観測済みの所有者を初期値にしています。正式な人間レビュー担当に合わせて更新し、CODEOWNERSが有効でwrite権限を持つことを確認します。

設定予定を表示してから、**新しい専用repo**へ適用できます。実行にはGitHub CLIの管理権限が必要です。トークンをファイルや引数に書きません。

```sh
python scripts/configure-github.py --repo OWNER/REPO --reviewer HUMAN_LOGIN
python scripts/configure-github.py --repo OWNER/REPO --reviewer HUMAN_LOGIN --apply
```

main protection: PR必須、approval 1件以上、CODEOWNER必須、古いapprovalの無効化、最新pushの別actor承認、`docs-validate`成功とbranch最新化、会話解決、linear history、force push/削除禁止、管理者にも適用。

Actionsの既定権限はread、ActionsによるPR作成/承認は無効。workflowの既定permissionsは空、必要jobだけContents read。checkoutの資格情報保持なし。キャッシュ共有なし。依存更新PRは自動mergeしません。

`docs-production` environmentはmain branchだけを許可します。Human reviewはPRに集約し、merge後は自動デプロイします。`docs-rollback` はmain限定かつ人間のenvironment承認が必要です。

rollbackは明示的な手動操作なので、指定した人間が起動と承認を兼ねられる設定です。PRの別actorレビュー要件とは分けています。

private repoのbranch protectionとenvironment protectionの利用可否はGitHubプランによります。APIが拒否したら制御を外して続けず、対応プランまたは組織の運用を選定します。repoを公開して回避する運用はしません。

設定スクリプトは適用開始時に `DOCS_DEPLOY_ENABLED=false` にします。既存repoへの安易な再適用は避けてください。異なる既存環境branch policyを検出した場合も有効化せず停止します。

## Cloudflare

最初は `workers.dev` の専用Worker。`wrangler.json` の `name` を確定し、カスタムドメイン・DNS・KV・R2・D1・Workerスクリプトは追加しません。`preview_urls=false`。PR previewをCloudflareへデプロイしないため、preview tokenは不要です。

カスタムAPI tokenは対象のCloudflare accountだけに絞った **Account / Workers Scripts / Edit** を出発点にします。固定account IDを指定するのでアカウント一覧探索権限を不要にします。Zones / DNS / Workers Routes / KV / R2 / D1 / API Tokens編集などを便宜的にまとめて付与しません。初回実デプロイで追加権限が要求された場合は、失敗APIと必須権限を照合して必要な範囲だけを変更します。

Workers Scripts権限は通常account単位です。「このWorker一つにしか使えないtoken」とは主張しません。他の重要Workerと強く隔離するなら専用accountを使います。有効期限とrotation運用を設定し、Global API Keyは使いません。

各GitHub environmentに設定します:

| environment | secret | variable |
|---|---|---|
| docs-production | CLOUDFLARE_API_TOKEN | CLOUDFLARE_ACCOUNT_ID |
| docs-rollback | CLOUDFLARE_API_TOKEN | CLOUDFLARE_ACCOUNT_ID |

tokenはGitHubのenvironment secret入力欄へ直接登録します。production / rollbackは可能なら別token。repo-levelやMarkdown、Obsidian、チャット、ZIPへ保存しません。

設定・PR review・previewを確認したら、repo variable `DOCS_DEPLOY_ENABLED=true` を設定します。初回PRのmain mergeが自動デプロイを開始します。既にmerge済みなら、レビュー済みの小さなdocs変更PRをmergeして開始してください。

## Previewと本番

PRの `Docs CI` から `docs-preview-<commit>` を取得し、ローカルHTTPサーバーで確認します。これは非公開Web preview URLではなく、GitHubのアクセス制御下のartifactです。repoの閲覧権限がある人はartifactを読めます。`noindex` は認証制御ではありません。

本番は独立runnerでbuild/testし、static artifactをSHAでbindして別deploy jobへ渡します。deploy jobはビルド側依存を入れず、固定したWrangler専用依存をインストールします。secretは最後のdeploy stepだけへ注入します。資格情報を与える対象はmain上のレビュー済みworkflow/toolingであり、SHA pinだけで悪意あるmain変更から守れるとは考えません。

## 初回live acceptance

1. GitHubのrequired check・CODEOWNERS・branch/environment制限が実際に効くことを確認。
2. docs変更PRを作り、secretなしでCIが通り、previewに未選択ページがないことを確認。
3. 人間が承認してmain merge。Cloudflare deploy成功ログとWorker version IDを保存。
4. 実URLのトップ、4記事、404、CSP / nosniff headers、スマホ表示を確認。
5. 小さな更新PRをmergeし、前versionへのrollbackを確認。その後Git側も整合させる。

これらが未実施の状態は `LOCAL_IMPLEMENTED_LIVE_PENDING`。GitHub Actions PASS・live deploy・live rollbackの証拠としてローカル試験を使いません。

## Rollback

通常の内容修正はrevert PRをレビューしてmainへmergeし、同じパイプラインで再公開します。

緊急時はまず `DOCS_DEPLOY_ENABLED=false` にして、進行中/待機中のproduction runをキャンセルします。Cloudflareの成功履歴から戻したいversion UUIDを確認し、改めてデプロイを有効にしたうえでmainから `Docs rollback` を実行、`docs-rollback` environmentの承認者が確認します。通常deployとrollbackは同じconcurrency groupで排他します。rollback開始前に余分なproduction runが残っていないことを確認してください。

rollback後は実URLを確認し、bad changeを戻すPRを作成。修正mergeでGitのmainと公開版を一致させます。Cloudflareだけ戻してGitを放置すると、次のmergeでbad changeが再公開されます。

Cloudflare versionはstatic assetsを含み、rollbackは新しいdeploymentを作ります。通常直近100versionが対象で、外部リソースの状態は戻りません。本pilotにはDB/bindingsを持たせません。機密情報が公開された事故ではrollbackだけで履歴・artifact・キャッシュ・秘密の無効化まで完了したことにしません。

## 参照（2026-09-14確認）

- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/get-started/)
- [Cloudflare versions](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

Actions固定SHAは公式repoのtagを直接照合: checkout v4.2.2 / setup-node v4.4.0 / upload-artifact v4.6.2 / download-artifact v4.3.0。
