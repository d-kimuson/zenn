// @ts-check
import Anthropic from "@anthropic-ai/sdk"
import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"

const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"],
})

/** @type {(indent: number, text: string) => string} */
const dedent = (indent, text) =>
  text
    .split("\n")
    .map((line) => line.slice(indent))
    .join("\n")

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

/** @type {(content: string) => Promise<JSON>} */
export const reviewArticle = async (content) => {
  const message = dedent(
    2,
    `
  記事のレビューをお願いします。
  記事の原稿は以下の通りです
  ---
  ${content}
  `
  )

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

const main = async () => {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    throw new Error("Usage: node claude_review.mjs <file-path>")
  }

  const filePath = args[0]

  const content = await readFile(filePath, "utf-8")
  console.log(await reviewArticle(content))
}

await main().catch(console.error)
