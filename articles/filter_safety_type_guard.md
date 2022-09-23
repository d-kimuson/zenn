---
title: "配列の filter で直和型を絞り込むときのユーザー定義型ガードを比較的型安全に書く"
emoji: "🐕"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["TypeScript"]
published: false
---

## 配列の filter メソッドでは直和型が絞り込まれない

配列 の filter メソッドでは直和型の絞り込みができないことが知られています

```ts
type User = {
  id: number
  name: string
}

declare const maybeUsers: (User | undefined)[]

const users /*: (User | undefined)[] */ = maybeUsers.filter(
  (maybeUser) => maybeUser !== undefined
)
```

`!== undefined` しているので自明に `undefined` は除かれて `User[]` 型に推論されてほしいところですが、callback は boolean を返すだけなので `(User | undefined)[]` に推論されていしまいます

## ユーザー定義型ガードによる解決と型安全性

この問題への一般的な解決策としてユーザー定義型ガードを使ったやり方がよく使われます

```ts
const usersGuarded /*: User[] */ = maybeUsers.filter(
  (maybeUser): maybeUser is User => maybeUser !== undefined
)
```

これで `User[]` 型に絞り込むことができました

ただし、ユーザー定義型ガードはガードの実装が正しいかを型チェックで検証できないので、型安全性の意味で危険なものです

例えばうっかり `=== undefined` にしてしまったり

```ts
const usersGuarded /*: User[] */ = maybeUsers.filter(
  (maybeUser): maybeUser is User => maybeUser === undefined
)
```

真逆なことを書いてしまっていて `usersGuarded` には実際には `undefined[]` な配列が入りますが有効です

あるいは、将来的に `maybeUsers` の型が変わった時にも

```ts
declare const maybeUsers: (
  | User
  | OtherUser // 後から追加された
  | undefined
)[]

const usersGuarded /*: User[] */ = maybeUsers.filter(
  (maybeUser): maybeUser is User =>
    maybeUser !== undefined /* OtherUser かをチェックしていない */
)
```

これは誤ったユーザー定義型ガードの実装になります(`OtherUser` である可能性が不当に除かれてしまう)が、型チェックでこれを検知することはできません

## `Exclude<typeoof arg, undefined>` で書く

ユーザー定義型ガードを使う以上こういった問題は避けられませんが、ちょっとマシな書き方があります

`Exclude<typeoof arg, undefined>` です

```ts
const usersGuarded /*: User[] */ = maybeUsers.filter(
  (maybeUser): maybeUser is Exclude<typeof maybeUser, undefined> =>
    maybeUser !== undefined
)
```

この書き方だと引数の型から `undefined` を除いた型に絞り込むという記述になるのでより安全かつ実態に即しています

やや冗長ですが、これで将来的な変更で型ガードの実装が壊れることは防げるようになりました

## 応用編

ちょっと応用編です

`filter` で使いたくなるユーザー定義型ガードは本来 `if` 文の中ではフロー解析でユーザー定義型ガードを使わずとも型を絞り込むことができるものも多いです

これまでの例の `undefined` を取り除く例も `if` の分岐なら危険なユーザー定義型ガードを使わずに絞り込むことができます

```ts
declare const maybeUser: User | undefined

if (maybeUser === undefined) {
  // この分岐の中では `User` に絞り込まれる
} else {
  // こちらの分岐では `undefined` に絞り込まれる
}
```

そこで、フロー解析であれば型を絞り込めることを利用して

```ts
;(maybeUser, exclude) => (maybeUser !== undefined ? maybeUser : exclude)
```

なインタフェースで、利用時に filter 関数を渡す形にできれば安全に利用できます

このためのユーティリティを準備します

```ts
const guardSymbol = Symbol()
type GuardSymbol = typeof guardSymbol

export const filterGuard = <Base, Ret extends Base | GuardSymbol>(
  cb: (base: Base, exclude: GuardSymbol) => Ret
): ((base: Base) => base is Exclude<Ret, GuardSymbol>) => (
  base: Base
): base is Exclude<Ret, GuardSymbol> => cb(base, guardSymbol) !== guardSymbol
```

利用側は

```ts
const usersGuarded /*: User[] */ = maybeUsers.filter(
  filterGuard((maybeUser, exclude) =>
    maybeUser !== undefined ? maybeUser : exclude
  )
)
```

こんな感じで、型ガードされた値と exclude を返してもらう感じです

これでフロー解析でガードできるものは filter でも安全にガードできるようになりました

(filterGuard の実装が間違ってたら壊れるのは変わらずですが、危険性がここに閉じてるので必要になるたびにユーザー定義型ガードを書くより安全です)

まあインタフェースがわかりにくいのはそうなので、型安全性と天秤にかけて使いたければって感じになります

## 番外編: flatMap を使う

filter とは記事の趣旨がズレますが、flatMap を使えば型を除きたい側の分岐で空配列を返し、型が絞り込まれた側で引数を返してあげることで、ユーザー定義型ガードなしに配列を絞り込むことができます

```ts
const usersGuarded /*: User[] */ = maybeUsers.flatMap((maybeUser) =>
  maybeUser === undefined ? [] : [maybeUser]
)
```

## まとめ

できるだけ安全に filter しようぜ
