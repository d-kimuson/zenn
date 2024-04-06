---
title: "GitHub ActionsでZennの下書きをClaudeにレビューしてもらう"
emoji: "💀"
type: tech
topics: ["githubactions", "ai"]
published: true
---

## はじめに

GitHub ActionsとClaude APIを組み合わせて、Zennの下書きをChatGPTライクなAIモデルであるClaudeにレビューしてもらう仕組みを作ってみたので紹介します。

## 記事を書くときにPull Requestを作る

僕は普段Zennのリポジトリでは特にレビューしてもらったりということがないのですべてmainブランチで運用していましたが、PRでレビューしてもらうにあたって Pull Request を作るように変更しました。

mainブランチに比べてPR作ったりが面倒なので以下のスクリプトで記事の作成・PRを作成します。

```bash
#!/usr/bin/env bash

set -eux

# 記事名と記事slugを対話形式で入力させる
read -p "記事名を入力してください: " title
read -p "記事slugを入力してください: " slug

# 記事slugを使って `articles/${slug}.md` にmarkdownファイルを作成する
touch articles/${slug}.md

# frontmatterを記載する
echo "---" > articles/${slug}.md
echo "title: \"$title\"" >> articles/${slug}.md

# ランダムな絵文字を生成する
emojis=("😀" "😁" "😂" "🤣" "😃" "😄" "😅" "😆" "😉" "😊" "😋" "😎" "😍" "😘" "😗" "😙" "😚" "🙂" "🤗" "🤩" "🤔" "🤨" "😐" "😑" "😶" "🙄" "😏" "😣" "😥" "😮" "🤐" "😯" "😪" "😫" "😴" "😌" "😛" "😜" "😝" "🤤" "😒" "😓" "😔" "😕" "🙃" "🤑" "😲" "☹️" "🙁" "😖" "😞" "😟" "😤" "😢" "😭" "😦" "😧" "😨" "😩" "🤯" "😬" "😰" "😱" "🥵" "🥶" "😳" "🤪" "😵" "😡" "😠" "🤬" "😷" "🤒" "🤕" "🤢" "🤮" "🤧" "😇" "🤠" "🤡" "🥳" "🥴" "🥺" "🤥" "🤫" "🤭" "🧐" "🤓" "😈" "👿" "👹" "👺" "💀" "👻" "👽" "🤖" "💩" "😺" "😸" "😹" "😻" "😼" "😽" "🙀" "😿" "😾")
emoji=${emojis[$RANDOM % ${#emojis[@]}]}
echo "emoji: \"$emoji\"" >> articles/${slug}.md

echo "type: tech" >> articles/${slug}.md
echo "topics: []" >> articles/${slug}.md
echo "published: false" >> articles/${slug}.md
echo "---" >> articles/${slug}.md

# `articles/${slug}` のブランチを作成する
git switch -c articles/${slug}

# 新規作成したブランチでコミットする
git add articles/${slug}.md
git commit -m "新規記事追加: ${slug}"

# pushする
git push -u origin articles/${slug}

# gh cliを使ってPull Requestを作成する
gh pr create --title "新規記事: ${title}" --body "この PR は新規記事 ${title} を追加します。" --base main --head articles/${slug} --draft
```

このスクリプトを使うと、対話形式で記事名とslugを入力すれば自動的に

- ブランチ
- 記事ファイル
- Pull Request

が作成されます。

## opened, ready_for_review, reopened に trigger して workflow を起動する

synchronizedだとdiffを投げるたびにレビューが飛んできてしまうので、opened, ready_for_review, reopenedのタイミングでレビューしてもらうようにします。

```yaml
on:
  pull_request:
    types: [opened, ready_for_review, reopened]
```

## 依存するパッケージのインストール

スクリプトは GitHub Script で書いていくので、必要な型定義とパッケージをインストールしておきます。

```bash
$ pnpm add -D @actions/github @anthropic-ai/sdk @octokit/rest @octokit/types
```

## Claude APIを呼び出す

次に、GitHub ActionsからClaude APIを呼び出してレビューコメントを生成していきます。

```javascript
// @ts-check
const { default: Anthropic } = require("@anthropic-ai/sdk")
const { readFile } = require("node:fs/promises")

const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
})

const systemPrompt = `
以下は技術ブログ記事の原稿です。この記事をレビューし、以下の項目についてコメントを JSON 形式で出力してください。

- 要約: 記事の概要を簡潔にまとめてください。
- 構成: 記事の全体的な構成について、改善点や提案があればコメントしてください。 
- 細部指摘: 記事の細部について、気になる点や修正すべき点があれば行数とともにコメントしてください。

出力は以下の JSON 形式に従ってください。
{
  "summary": "記事の要約",
  "structure": "構成に関するコメント", 
  "details": [
    {
      "line": 行数,
      "comment": "指摘内容"  
    },
    ...
  ]
}

文字数を節約するため、簡潔なレビューを心がけてください。`

const messageTemplate = `
記事のレビューをお願いします。
記事の原稿は以下の通りです
---
`

/** @type {(content: string) => Promise<{ summary: string, structure: string, details?: ReadonlyArray<{ line: number, comment: string }> }>} */
const reviewArticle = async (content) => {
  const message = messageTemplate + "\n" + content

  const result = await anthropic.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: "user", content: message },
      { role: "assistant", content: "{" },
    ],
  })

  const outputJson = `{${result.content.at(-1)?.text}`
  return JSON.parse(outputJson)
}
```

machine readable なデータがほしいので json 形式の出力を指定し、`assistant` 側の `{` を指定しておくのがポイントです。

## レビュー内容を GitHub Review Comment として投げる

レビュー内容を GitHub に投げる部分を書いていきます。

```javascript:.github/scripts/ai-review/index.cjs
/**
 * @typedef {import("@octokit/rest").Octokit} OctokitClient
 * @link https://octokit.github.io/rest.js/v20#usage
 */

/** @typedef {import("@actions/github").context} WorkflowRunContext */

/** @type {(arg: { github: { rest: OctokitClient }, context: WorkflowRunContext }, changedFiles: ReadonlyArray<string>) => Promise<void>} */
module.exports = async ({ github, context }, changedFiles) => {
  const pr = context.payload.pull_request
  if (pr === undefined) throw new Error("Unexpected.")

  for (const file of changedFiles) {
    const fileContent = await readFile(file, "utf-8")
    const wordCount = fileContent.length

    if (wordCount < 100) {
      console.log(`File ${file} is too short (${wordCount} words)`)
      continue
    }

    const { summary, structure, details } = await reviewArticle(fileContent)
    console.log({
      summary,
      structure,
      details,
    })

    if (details === undefined || details.length === 0) {
      await github.rest.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
        event: "APPROVE",
        body: structure,
      })
      return
    }

    await Promise.all([
      ...details.map((detail) =>
        github.rest.pulls.createReviewComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: pr.number,
          body: detail.comment,
          commit_id: pr.head.sha,
          path: file,
          line: detail.line,
        })
      ),
    ])

    const review = await github.rest.pulls
      .createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
        event: "COMMENT",
        body: structure,
      })
      .then((res) => res.data)
  }
}
```

## workflow から GitHub Script を呼び出す

最後に GitHub Script を呼び出す workflow を作ります。

```yaml
name: AI Article Review

on:
  pull_request:
    types: [opened, ready_for_review, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    if: startsWith(github.head_ref, 'articles')

    env:
      GH_TOKEN: ${{ github.token }}
      PR_URL: ${{ github.event.pull_request.html_url }}

    steps:
      - uses: actions/checkout@v4

      - name: Install Node.js
        uses: actions/setup-node@v3
        with:
          node-version-file: ".node-version"

      - uses: pnpm/action-setup@v2
        name: Setup Pnpm
        with:
          run_install: false

      - name: Get pnpm store directory
        shell: bash
        run: |
          echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

      - uses: actions/cache@v3
        name: Setup pnpm cache
        with:
          path: ${{ env.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-store-

      - name: Install dependencies
        shell: bash
        run: pnpm i --frozen-lockfile

      - name: Get changed files
        id: changed-files
        uses: tj-actions/changed-files@v35
        with:
          files: articles/**
          json: true
          json_raw_format: true

      - name: Review articles
        if: steps.changed-files.outputs.any_changed == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            return await require('./.github/scripts/ai-review/index.cjs')({ github, context }, ${{ steps.changed-files.outputs.all_changed_files }})
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

`tj-actions/changed-files` で diff を取り記事ファイルが見つかれば対象のファイルを GitHub Script に渡してレビューさせます。

## まとめ

簡易的ですが Claude を使って記事レビューをする仕組みを GHA で作ってみました。

改善の余地としては

- レビュー状態のより厳格な制御
  - ちゃんとやるならラベルを使う等してApprove/Request Changes をちゃんとするほうが良いかも
- レビューコメントでのやり取り

等がありそうですが、そこまで厳格にやっても仕方ないかなと思うのでこれで運用してみようと思っています。
