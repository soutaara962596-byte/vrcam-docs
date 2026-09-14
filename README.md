# VRCAM Documentation / Knowledge Publication Pilot

Markdown / Obsidian → AIによる編集・branch・draft PR → Human review → main → GitHub Actions → Astro静的ビルド → Cloudflare Workers Static Assets。

本体から独立したdocs専用リポジトリ用の実装です。サンプル4記事を同梱しています。ローカルで構築・検証済みの範囲と、GitHub / Cloudflareの実運用設定は `docs/OPERATIONS.md` と返却検証記録で区別します。リモート未接続の状態ではデプロイは既定で停止します。

## 起動

Node.jsは `.node-version`、pnpmは `package.json` に固定しています。Python 3.12以降とGitを使います。PR作成・GitHub設定には認証済みGitHub CLIが必要です。

```sh
npm install --global --ignore-scripts pnpm@11.19.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
python -m unittest discover -s tests -p '*_test.py' -v
```

`pnpm check` はGitの追跡対象も検査するため、展開したZIPから使う場合は先に `git init` と `git add .` が必要です。ローカル表示は `pnpm dev`。停止はCtrl+C。`dist` が公開物の全体です。README、内部運用文書、テスト、検証記録はWebへ入りません。

## 記事を書く

`authoring` を**公開用の別Obsidian Vault**として開きます。内部のVRCAM Vault全体を同期・コピーしません。標準Markdownリンクを使い、Obsidianの「新規リンクにウィキリンクを使用」をオフにします。プラグイン・自動Git同期は必須にしません。

新規記事を `authoring/public/` に作ります。

```yaml
---
title: 記事のタイトル
category: faq
publication: public
---
```

カテゴリは `handoff` / `adr` / `release-notes` / `faq`。pilotではHTML、MDX、画像、埋め込み、wikiリンク、Obsidianコメントを拒否します。HTTPSリンク、選択済み記事への `/docs/slug/` リンク、通常のMarkdown本文を利用できます。

選択するMarkdownはUTF-8・LF改行に統一します。CRLFまたは単独CRを含むファイルは、`pnpm select` がmanifestを変更する前に説明付きで拒否します。エディタの改行コード設定でLFへ変換して保存し、改めて選択してください。Gitのglobal設定を変更する必要はありません。PR送信前にはGit indexとcommitから実際のsource bytesを読み、`publication.json` のSHAと再照合します。

```sh
pnpm pr faq-update prepare
# Markdownを編集する
pnpm select authoring/public/faq.md faq
pnpm pr faq-update submit
```

`prepare` はclean treeから `origin/main` に基づくbranchを作り、`submit` は対象ファイルだけを検査・commit・push・draft PRにします。自動mergeはしません。`submit` がpush後に通信エラーとなった場合は、既存branch/PRを確認してからPR作成だけ再開します。

記事の削除は `publication.json` から該当entryを除外し、不要なMarkdownも削除するPRにします。生成物は毎回再生成するため、削除済み記事は公開物に残りません。

## 安全性の仕組み

- `publication.json` のsource / slug / SHA-256と `publication: public` の両方が必要。
- 選択後の本文変更、重複、リンク切れ、パス逸脱、symlink/junction、秘密情報の既知パターンを拒否。
- 生成JSON、選択manifest、PR本文はwrite前に各entry自体を`lstat`し、dangling linkや通常ファイル以外を拒否。
- MarkdownはHTMLを拒否したうえでsanitizerを通し、ブラウザへJavaScriptを配信しない。
- PRはsecret不要のCIとダウンロード式preview artifact。本番資格情報を渡さない。
- 本番はmain限定・専用environment・最新main SHA確認・同一run artifact・共有排他でデプロイ。
- Actionsは実在する公式tagの40桁commit SHA、依存はexact versionとlockfileに固定。

秘密情報検査は既知パターンの補助です。個人情報・未公表の判断・文脈上の秘密を完全判定できません。`publication: public` とSHAもHuman approvalの証拠にはなりません。**最終の公開可否はHuman PR reviewで決めます。**

出力パス検査は、信頼されたローカルcheckoutでpublication/select/PR処理を単一writerとして実行する前提です。同じcheckoutへ書き込める別processが検査と書込みの間にpathを差し替える競合まで防いだとは主張しません。同じcheckoutでこれらの処理を同時実行しないでください。危険なlinkを見つけた場合は自動削除・置換せず停止します。

## 次の設定

GitHubの初期登録、レビューする人とPR作成者の分離、Cloudflare token、環境設定、rollbackは [運用手順](docs/OPERATIONS.md)。既存共有基盤との接続は [HRR接続](docs/HRR_INTEGRATION.md)。
