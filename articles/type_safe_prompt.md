---
title: "type-safe-prompt というプロンプトに型安全に変数を埋め込める薄いライブラリを書いた"
emoji: "😿"
type: tech
topics: ["llm", "chatgpt", "typescript"]
published: true
---

@[tweet](https://x.com/_kimuson/status/1808835552453742659)

これをしてくれるちょうど良いライブラリが見つからず、さっと作って公開したので紹介します。

## やりたかったこと

ChatGPT 等の API を TypeScript から触るときに、プロンプトのテンプレートを作って変数を埋め込む、みたいな抽象化がしたくなります。

例として、任意のテキストを英語に翻訳させるためのプロンプトでは

```typescript
const myPrompt = `
あなたは優れた翻訳者です。
以下のテキストを自然な英語に直してください。

\`\`\`
{{originalText}}
\`\`\`
`
```

この `originalText` の部分です。

愚直に関数で抽象化しようとすると

```typescript
const myPrompt = (vars: { [K in "originalText"]: string }) => {
  return `
あなたは優れた翻訳者です。
以下のテキストを自然な英語に直してください。

\`\`\`
${vars.originalText}
\`\`\`
`
}
```

このような形になります。

悪くはないですが、インデントが崩れて読みづらくなるのと、変数部分の管理・毎回関数を書かなきゃいけないことがめんどくさいです。

他に [LangChain](https://github.com/langchain-ai/langchainjs) を使っていれば `PromptTemplate` を使う方法もありますが

```typescript
const myPromptText = `
あなたは優れた翻訳者です。
以下のテキストを自然な英語に直してください。

\`\`\`
{originalText}
\`\`\`
`

const myPrompt = new PromptTemplate({
  inputVariables: ["originalText"],
  template: myPromptText,
})

// 当てはめる
myPrompt.invoke({
  inputVariables: "こんにちは！",
})
```

こちらは型検査をしてくれないのが微妙なのと、LangChain を他の目的で入れているならともかくこれだけのためにいれるのは違うなという感じでした。

記事の本筋とか関係ありませんが、個人的に言語機構による抽象化に比べて LangChain で抽象化する利点があまり見いだせておらず、むしろ筋が悪いように感じているのであまり積極的に採用したくないというのもあります。

## というわけで作った

https://github.com/d-kimuson/type-safe-prompt

npm からインストールできます。

```bash
$ pnpm add type-safe-prompt
```

使い方はシンプルで、文字列として定義したテンプレートをライブラリが提供する関数に渡すだけです。

```typescript
import { fillPrompt } from "type-safe-prompt"

const promptTemplate = `
あなたは優れた翻訳者です。
以下のテキストを自然な英語に直してください。

\`\`\`
{{originalText}}
\`\`\`
`

const prompt = fillPrompt(promptTemplate, {
  originalText: "こんにちは！",
})
```

`fillPrompt` では `promptTemplate` の型から再帰的に `{{varName}}` の形を抽出して第 2 引数で必要な値を型付きで要求します。

なので、例えば

```typescript
const prompt = fillPrompt(promptTemplate, {
  originalTextMissed: "こんにちは！",
})
```

のように埋め込みの変数名の指定を間違った時は、型エラーになります。

![](https://storage.googleapis.com/zenn-user-upload/0dbc48b83efe-20240715.png)

また、戻り値にも型がついているので、実行しなくてもどういうプロンプトを解決されるのか確認できて便利です。

![](https://storage.googleapis.com/zenn-user-upload/86636ca07523-20240715.png)

## pnpm を使っているならリリース周りは tsup + release-it が良かった

npm ライブラリを **ちゃんと** 公開しようとすると割とめんどうで

- CommonJS から ESModules への移行期なので Dual Package 対応
  - exports フィールドを埋めたり、esm, cjs 向けにそれぞれビルドしたりする必要がある
- package.json#version をあげる
- CHANGELOG を書く
- tag を切る & GitHub にリリースを作る
- npm に publish する

と言った対応が必要で結構めんどくさいです。

が、[tsup](https://tsup.egoist.dev/) + [release-it](https://release-it-pnpm.vercel.app/) を使うとこの辺の面倒をかなり見てくれてとても手軽でした。

まず tsup を使うと

- TypeScript ファイルのトランスパイル
- バンドル
  - ※ バンドルされていると exports フィールドに 1 つだけ書けば良いので楽
- 型定義の生成

が 1 コマンドで実行できます。

そしてリリース周りの面倒を見てくれるツールはいくつかありますが

- [sindresorhus/np](https://github.com/sindresorhus/np) は npm 用で pnpm はサポートされていない
- [semantic-release/semantic-release](https://github.com/semantic-release/semantic-release) は、(ちゃんとやるなら良いと思うんですが)個人的にコミットメッセージのみでそこまで厳格なバージョン管理をできるイメージが沸かずハードルが高かった

という感じでちょうど良いツールを知らなかったんですが、release-it を使うと対話形式で

- バージョンの書き換え
- CHANGELOG の更新
- tag を切る & リリース用コミットの作成
- publish
- GitHub Release の作成

までシュッと対応できて使いやすかったです。

ちょっとしたライブラリを作るときにとりあえず採用しておくと楽に公開できて良いなという感じでした。

## 終わりに

LLM のプロンプトを書くときに手軽に変数埋め込みができるライブラリを作ったので紹介しました。
かなり薄くて入れるも外すもすぐなので、良ければ使ってみてください。
