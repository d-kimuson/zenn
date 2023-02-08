---
title: "TS 4.9 が使えない環境に送る satisfies ヘルパー関数"
emoji: "📘"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["typescript"]
published: true
---

みなさん satisfies operator は使ってますか？

この記事では、satisfies が手に馴染んだけどまだ TS 4.9 に移行できていない環境で作業している人に向けた satisfies を代替するヘルパー関数を紹介します

## satisfies とはなにか

[satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator) は TS 4.9 で追加された演算子です

型注釈には

- 変数等の型を注釈した型に推論させる
- 注釈した型を満たすように制約を設ける

の 2 つの効果があり、制約の効果のみ取り出したものが satisfies operator です

いつ制約だけあると嬉しいかと言うと、制約よりも値(宣言)のほうが厳格なケースです

```ts
type ILang = {
  lang: string
}

const valueAnnotation: ILang = {
  lang: "typescript",
} as const // : ILang
```

この場合、`string` よりも `'typescript'` のほうが厳格なので `'typescript'` に推論されると嬉しいですが、型注釈では `string` に推論されます

一方 satisfies で制約のみ課せば

```ts
const value = {
  lang: "typescript",
} as const satisfies ILang // :{ readonly lang: "typescript" }
```

`'typescript'` に推論されて望ましいです

また、例えば「リポジトリ層の関数の戻り値への制約として `正常系 | BaseError` を返す」があるとして

```ts
class BaseError extends Error {}
class SomeError extends BaseError {}
type IRepository<Args extends unknown[], Ret> = (
  ...args: Args
) => Promise<Ret | BaseError>

declare const db: string[]

const langRepository = (async (lang) => {
  if (!db.includes(lang)) {
    return new SomeError()
  }

  return { lang }
}) satisfies IRepository<[string], ILang>
```

satisfies で制約だけ貸すと、異常系が具体の型に推論されて望ましいね、みたいなこともできますね

あとは変数に代入せずともチェックできるので、網羅チェックも未定義変数を用意せずにかけます

```ts
declare const union: "typescript" | "rust" | "go"

switch (union) {
  case "typescript":
    break
  case "rust":
    break
  case "go":
    break
  default:
    union satisfies never
}
```

## satisfies を代替する関数

ということで、satisfies を使いたくなりますが、TS 4.9 まであげないと使うことができません

わざわざ注釈書くときって、僕の場合は制約が欲しくて書いていることがほとんどなので、最近は基本 satisfies が使いたいなという気持ちなんですが、残念なことに TS 4.9 まであげないと使うことができません

ただし、satisfies と同様の役割を果たすヘルパーを作ることはできます

```ts
export const satisfies =
  <T extends unknown>() =>
  <U extends T>(value: U) =>
    value
```

使い方としては T の型引数は明示的に指定して、U は推論させます(明示しません)

```ts
const value = satisfies<ILang>()({
  lang: "typescript",
} as const)
```

補足すると、型引数 `T` は明示しているので当然 `ILang` 型に解決されます。`U` は `extends ILang` によって `ILang` の制約がかかりますが、ちょうど `ILang` に推論されるわけではなく渡された引数 value の型に推論されます

これで擬似的に推論は値にまかせて制約だけ課すことができます

![](https://storage.googleapis.com/zenn-user-upload/4156fe441dad-20230208.png)

具体の型に推論されますし

![](https://storage.googleapis.com/zenn-user-upload/0f827ca87440-20230208.png)

制約を満たさない場合には型エラーが発生します
冒頭で紹介した 2 パターンも satisfies 関数で書くことができます

```ts
// : (lang: string) => Promise<ILang | SomeError>
const langRepositoryWithSatisfiesFn = satisfies<IRepository<[string], ILang>>()(
  async (lang) => {
    if (!db.includes(lang)) {
      return new SomeError()
    }

    return { lang }
  }
)
```

```ts
declare const union: "typescript" | "rust" | "go"

switch (union) {
  case "typescript":
    break
  case "rust":
    break
  case "go":
    break
  default:
    // 網羅されていないとエラーが出る
    satisfies<never>()(union)
}
```

## まとめ

この記事では TS 4.8 以下で satisfies を代替するヘルパー関数を紹介しました

この記事で紹介しているサンプルコード・ヘルパー関数は以下のプレイグラウンドで試すことができます

https://www.typescriptlang.org/play?#code/C4TwDgpgBAkgMgQwHYHMoF4oG8BQUoA2yKAXFAM7ABOAlqjgL444DGA9kpRQsDeQGY0I5DHigAeACpQIAD2AQkAExEBXJAGskbAO5IAfAAoAlBn1jxAVRnzFKqJKMA3BAVUQyl0+nP58Ltwhmdk5gKAD3AEEkbWAeGg4yeGIMbDEiVDIAIlBIchZaMGAsxigEERDKYI4uCIgAZXiBIRFMXHwM0igc8GECmiKsgBpS8qhKsPImwWFYRHpWGrC6xt5m4QAxJFSptZnycWTUI2NDdsJibNy+wuKRhjKKpeNmOujY+I4cAHpvqAA9AD8r1c7lWfH2Pz+QJBgXB63IWyhAOBrCI5BEACFyhAAKJUKhsKg2BTKET4wnErBMFjokT1NgAWzxBKJJLsWJxFLZ1Jw11gACUIGA2OQaMAiSBxJEqCgRHJSfZ1FpdEgANoAXSGUCFwH0qUMYgAdCaELLyGQZXKcN59QAFQmMvgQcS6qAAHyg2PILMp5hwSggtLN0AmUCUACMyJRaKhNdVQhdUEKRWKJVQQAbyiAkCwoIZOra0vgaPx8wBCSNGui01SB8gF4jGUznfBUCDAVRUbZICA6KAM5ncqgmMRMMTtzvd7BJtBMBimXYQlqC4Wi8WS8RqmN0FBaubEf1hzop9fpkAAdXFAAt4fstjtpi1Dqe05vt9Rd-ujih9CdDfg2a5vmhZmMWfilhWVY1m49aNqgzbgX4UCTl2PZ9gOTK+kSo7IeOyGodOWCzlATD4AuzAnmub4ZsiMI4FRqYbhmV7ALeT6bEgdGor8NjXggqiUDQTiKMIFTXkGGgBkGRDtuMSxQOoCRIGQADk1z5LcqkelAqlUIJwDaZ6qkoGwqk4OQOjiiw16GEpHAtmILA4rpGn9EUqkkGI+ARu2CAaAA3E5Ll6QZnneVAvkQP5QX4M5Pq6aZ4XIVF-liIG-ACQQwBech9nbEuCJQL2IlUBFhX7OIJUQFQ-75S8TBAA
