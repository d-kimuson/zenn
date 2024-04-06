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
