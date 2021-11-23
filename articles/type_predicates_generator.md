---
title: "TypeScriptの型定義から型ガードを自動生成する type-predicates-generator の紹介"
emoji: "📘"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["TypeScript", "type"]
published: true
---

TypeScript の型定義からユーザー定義型ガード(type predicate)とアサーション関数を自動生成するツールを作ったので紹介します！間違った実装を書いてしまう可能性があるユーザー定義型ガードを自動生成することで、安全かつ手軽にアプリケーションの型を守ることができます！

https://github.com/d-kimuson/type-predicates-generator

## type predicate と問題点

API や JSON のパース等で外部からやってきた値に型付けをするときや型定義の存在しないライブラリを使用する時、型注釈や as をそのまま使ってしまうと想定していない値がきたときに気付くことができません

```ts
type Task = {
  id: number
  titile: string
  description: string
}

const task: Task = JSON.parse('...') // any 型を返す関数に対して注釈を書く
task /* :task */ // 実際には any 以外の値でも Task 型についてしまう
```

型が実態と異なっているとアプリケーションの安全性の意味でも、開発体験の意味でも TypeScript によって得られる利点が減ってしまうので望ましくありません

こういうときに [type predicate](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates) (`v is <型>`) を使うことで、ユーザー定義の関数使って型ガードを行い、安全に型付けすることができます

```ts:type_predicateのサンプル
function isTask(value: unknown): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'description' in value &&
    typeof value.description === 'string'
  )
}

if (isTask(task)) {
  // isTask が true を返したら、task は Task 型であることにする
  task /* :Task */
}
```

これなら as や型注釈で型をつけるより安全ですが TypeScript はこの type predicate 関数の実装が正しいかについては一切面倒を見てくれません

極論ですが、`const isTask = (v: unknown) v is Task => true` 等のめちゃくちゃな実装でも特に怒られずに型を Task 型に絞り込んでしまいます

もちろんこんな実装を書くことはないと思いますが

- 書いた当時は正しい実装だったが `Task` 型が変更されて isTask が不適切な実装になってしまうケース (プロパティの追加)
- 単純に実装ミスをするケース (`isTask` を見ての通りオブジェクトのプロパティチェック等をちゃんと書くのは結構複雑で、他にも共用体型や配列の子要素チェックなどもあるので十分ミスが入り込める)

等によって不適切なランタイムチェック関数が入ることもあります

また、いちいち type predicate を型ごとに書くのは大変なので、心理的にも type predicate 自体を書かずに型注釈や `as` で妥協してしまうことも多いと思います

## type-predicates-generator の紹介

[type-predicates-generator](https://github.com/d-kimuson/type-predicates-generator) では型定義から、type predicate 関数を自動生成することでこれらの問題を解決します

npm からインストールできます

https://www.npmjs.com/package/type-predicates-generator

```bash
$ yarn add -D type-predicates-generator  # or npm
```

`type-predicates-generator` コマンドに適切なオプションを渡すことで type predicate 関数が自動生成されます

```bash
$ yarn run type-predicates-generator -f 'path/to/types/**/*.ts' -o './type-predicates.ts'
```

`path/to/types/**/*.ts` にマッチするファイル内から export されている型宣言(type alias と interface) から predicates 関数を自動生成し、`type-predicates.ts` に書き出されます

試しに上の例で使用した `Task` 型を対象に type-predicates-generator を走らせると、以下のように自動生成されます

```ts:自動生成されたpredicate定義
import type { Task } from "path/to/your-type-declare"

const isNumber = (value: unknown): value is number => typeof value === "number"
const isString = (value: unknown): value is string => typeof value === "string"
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const isTask = (arg_0: unknown): arg_0 is Task =>
  isObject(arg_0) &&
  "id" in arg_0 &&
  isNumber(arg_0["id"]) &&
  "title" in arg_0 &&
  isString(arg_0["title"]) &&
  "description" in arg_0 &&
  isString(arg_0["description"])
```

あとは、自動生成された関数を使って、外部から値がやってきたときに使用してアプリケーションを守ってあげれば良いです

```diff
 import { isTask } from 'path/to/type-predicates'

 fetch("path/to/api").then(async (data) => {
-  const json: Task = await data.json(); // 本当に Task 型かチェックしていない危険な型付け
+  const json /* :any */ = await data.json();
+  if (!isTask(json)) throw new Error('Oops');  // チェックに失敗した場合、例外を投げる

   json /* :Task */
 })
```

これで安全かつ手軽に外部から来た値に型をつけることができるようになりました

`-a` オプションを指定すれば、加えて [assertion function](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-7.html#assertion-functions) も自動生成することができます。上のようなケースなら assertion function を使うほうが適切でしょう

```ts
// -a で追加で自動生成される
function assertIsTask(value: unkonwn): asserts value is Task {
  if (isTask(task)) throw new TypeError(`value must be Task but received ${value}`)
}

// 使用
const json /* :any */ = await data.json();
assertIsTask(json)  // 失敗した場合例外が発生する
json /* :Task */
```

自動生成なので、predicate を書く手間がなく心理的ハードルも低いですし、Task の変更に追従しにくいという問題も解決されます

watch モード(`-w`)もサポートしているので、開発時に watch も起動して変更をそのまま反映することもできます

![](https://storage.googleapis.com/zenn-user-upload/7be522e12a02-20211121.gif)

その他のオプションはリポジトリを参照してください

https://github.com/d-kimuson/type-predicates-generator#cli-options

## チェックできるものとできないもの

基本的には JSON で受け取れるようなデータ構造は全てサポートできるように作りました(ので、もし抜けがあったら Issue を立ててもらえるとありがたいです)

https://github.com/d-kimuson/type-predicates-generator/issues

逆に

- 関数/メソッド
- Promise
- 循環参照するデータ構造 (`obj1.recursive = obj2, obj2.recursive = obj1` のような)
  - ※ プロパティチェックの際にお互いがお互いのプロパティをチェックしにいくので無限ループになってしまいます

この辺りのチェックを行うことはできません

型演算に関しては基本的に全てサポートされます

Mapped Types や Conditional Types 等の複雑な型を使用していても、最終的に JSON シリアライズ可能な型やその交差型・共用体型に解決されるなら、問題なく生成できます

```ts:複雑な型からも生成できる
// 生成元: Partial では Mapped Types を使用している
type PartialTask = Partial<Task>;

// 生成関数: 最終的に解決された型から生成される
export const isPartialTask = (arg_0: unknown): arg_0 is PartialTask =>
  isObject(arg_0) &&
  ((arg_1: unknown): boolean => isUnion([isUndefined, isNumber])(arg_1))(
    arg_0["id"]
  ) &&
  ((arg_1: unknown): boolean => isUnion([isUndefined, isString])(arg_1))(
    arg_0["title"]
  ) &&
  ((arg_1: unknown): boolean => isUnion([isUndefined, isString])(arg_1))(
    arg_0["description"]
  )
```

## openapi-generator とともに使う

フロントエンドでは openapi-generator, aspida 等のツールでレスポンス型を自動生成していることも多いと思います

これらを直接 type-predicates-generator の生成対象に含めることも可能ですが、型定義が膨大になりがちで生成に時間がかかってしまうので、使うものだけ再エクスポートすることもできます

※ と言いつつ個人のブログで使用している [GraphQL Code Generator](https://www.graphql-code-generator.com/) で生成した4000行レベルの型定義で試しても5秒超くらいだったのであまり気にしなくても良いかもしれません

このユースケースのため型宣言だけではなく再エクスポートされた型定義も生成対象に含めています

```ts
export { Category } from "../typescript-axios/api"
```

リポジトリの [example](https://github.com/d-kimuson/type-predicates-generator/tree/main/example) に具体例があります。[re-export.ts](https://github.com/d-kimuson/type-predicates-generator/blob/main/example/types/re-export.ts#L4~L11) によって再エクスポートされた型定義から [type-predicate.ts](https://github.com/d-kimuson/type-predicates-generator/blob/main/example/type-predicates.ts#L100~L124) に関数が生成されているのがわかります

## どうやって実装しているのか？

Compiler API で Glob 指定されたファイルから型情報を抜き出して自動生成しています

Compiler API の詳細は他の記事に譲りますが

1. マッチしたファイルを対象に [Node](https://typescript-jp.gitbook.io/deep-dive/overview/ast#node) を探索して type alias と interface の宣言ノードを拾い出す
2. 宣言ノードから [TypeChecker](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#using-the-type-checker) を使って再帰的に型を拾っていき、独自に定義した [書き出しやすい型情報](https://github.com/d-kimuson/type-predicates-generator/blob/main/src/type-object.ts) として書き出し
3. 書き出した型情報をもとにごにょごにょしてコードを生成する

という流れです

https://github.com/d-kimuson/type-predicates-generator/blob/main/src/compiler-api/compiler-api-handler.ts

https://github.com/d-kimuson/type-predicates-generator/blob/main/src/generate/generate-type-predicates.ts

## その他の解決策

type predicate の実装が型定義と乖離する可能性がある問題を解決するライブラリとしてメジャーな [io-ts](https://www.npmjs.com/package/type-predicates-generator) があります

```ts:使用例
import { isRight } from "fp-ts/lib/Either";
import * as t from 'io-ts'

const TaskIO = t.type({
  id: t.number,
  title: t.string,
  description: t.string,
})

export type Task = t.TypeOf<typeof TaskIO>

// 使用例
const data /* :any */ = JSON.parse('...')
const result = TaskIO.decode(data)
if (isRight(result)) {
  const task /* :Task */ = result.right
}
```

io-ts 独自の記法でランタイムでチェックする型を定義し、そこから TypeScript の型を受け取る形になっています(`t.TypeOf(typeof Task)`)

とても良いライブラリですが、型定義を TypeScript の型で書けないので

- すでにある TS の型から型演算を通じて API 型を定義したい
- openapi-generator 等で型定義を自動生成している

といったケースには対応できず(型定義とは別に io-ts でランタイムチェックに使う型を定義する必要がある)、そういうシチュエーションでは type-predicates-generator が良い選択肢になると思います

## 終わりに

というわけで、type-predicates-generator の紹介でした！
まだ作ったばかりのライブラリですが、手軽に型安全性を高めやすいツールになってますので、ぜひ使ってみていただけると嬉しいです！
PR や Issue もお待ちしてます！
