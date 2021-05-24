---
title: "TypeScript の型情報を展開して見やすくする VSCode 拡張機能を作った"
emoji: "🌟"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: []
published: false
slug: 5ff64b17-108e-4c7e-b2c3-7465a8982f10
---

タイトル通りなんですが、TypeScript の読みにくい型を展開して読みやすくする拡張機能を作りました

画像

こういう人が読めないような型を VSCode 上で必要なだけ展開して確認することができるようにするもです

画像

GraphQL や OpenAPI 等から自動生成した型や、型計算を重ねて読みづらくなった型をシンプルに理解できます

ジェネリクスを使った複雑な型や、Pick, Extract 等も展開することができます

## 動機

TS を書いてると型が読めないから、変数に束縛して補完で探ってが必要なことが度々あって、展開した型をみれるなにかがないかなーと常々思っていました

TypeScript の [compilerAPI](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) なるものを知ったので、いい感じに型を抜き出して VSCode のツリービューに渡せば良いじゃんって思って調べてみたら同じ試みをされてる方がいらっしゃったのですが、残念ながら断念されてました

[type-explorer がポシャった話 - sisisin のブログ](https://sisisin.hateblo.jp/entry/2020/09/12/174228)

端的に言うと、compilerAPI の API が充実してないから逐次展開するみたいなことはできないそうで

ただ、拡張機能開発もやってみたかったというのもあったので、とりあえずダメ元で作ってみたら割と良い感じになったので公開します

## どうやったの

[compilerAPI](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) で VSCode 上で選択しているノードの型情報を取り出して、ツリービューに渡しています

型情報の抜き出しは [Using the Compiler API · microsoft/TypeScript Wiki · GitHub](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API#using-the-type-checker)

この辺を参考にしました

基本的に `Node` が渡ってくるので、そこからコネコネして必要な情報を受け取り、展開可能な

Node

が、選択しているノードごとに型のとり方が異なる + 一部 compilerAPI に必要な型定義が提供されていない問題があって苦戦しました

VSCode から受け取った時点では `Node` で、ここからプロパティがほしいときは

compilerAPI にはざっくりと

- Node (ソースコードから取得したやつ)
- Simbol
- Type

の 3 つが登場しますが、型定義

- 宣言から型を取りたい → Node => Type
- Type からプロパティを取りたい → Symbol で取得したプロパティを型に変換
- 変数から型を取りたい → Node → 初期化用 Node を取得 →

型は

## Tree View API

ツリービューの各要素は `vscode.TreeItem` で、親クラスのコンストラクタに `vscode.TreeItemCollapsibleState.Collapsed` or `vscode.TreeItemCollapsibleState.None` を渡すと

拡張機能が有効になったタイミングで `TreeDataProvider.getChildren` が呼ばれます

こちらは結構 API がシンプルだったので、かんたんに作れました

ただ、型を広げたいシチュエーションって

- プロパティを見たい
- Union の候補をみたい
- Enum の候補をみたい
- 関数の展開(引数と戻り値)

とか、結構パターンが有るのに、見た目的にはすべて折りたたまれているものを展開するだけなのでどう区別するか

ユーザーが展開できることは把握できるが、なにを展開できるのか・しているのかが分からない

とりあえず `TreeItem` に `description` を設定してやると

画像

こんな感じで、付随する情報を出せるので、どういう意味合いで展開できるのかが分かるようにしました

## 詰まったこと

### ファイルの変更を反映できない

watch するようにして、対応しました

### 再帰的な型を使えない

もともと、compilerAPI でコネコネして完全に展開された型をツリービューに渡してたのですが、再帰的な型だと当たり前ですが無限ループに入ってしまいます

```ts
type User = {
  friend: User
}
```

パフォーマンス的にも逐一展開したほうが無駄な計算をしなくてすむだろうしってことで、ビューの展開処理のタイミングで展開することにしました

### 公開すると手元で動いたのに、動かなくなる

手元ではちゃんと動いているのに、公開してインストールしてみると組み込みの型が使えなくなっていました

```ts
type Foo = Array<string>
type Bar = Pick<Hoge, "key1", "key2">
```

こういうの

結論から言うと `.vscodeignore` で必要なファイルを削ってしまっていたのが原因でした

`$ yo code` の TypeScript の雛形をほぼそのまま使ったんですが、`.vscodeignore` で `*.ts` を送らないようにしていたことが原因でした

一般的な拡張だと js だけ送れば良いので親切に指定してくれていたみたいですが、今回の場合は `compilerAPI` が型を解釈するタイミングで node_modules 下にある組み込みの型定義を参照するので、`ignore` から外す必要がありました

```diff:.gitignore
 .vscode/**
 .vscode-test/**
 out/test/**
 src/**
 .gitignore
 .yarnrc
 vsc-extension-quickstart.md
 **/tsconfig.json
 **/.eslintrc.json
 **/*.map
-*.ts
+src/**/*.ts
```

これだと一部無駄な型が送られてしまうのでなんとかしたいところ

否定オプションが使えるなら typescript だけ外したほうが良さそう

## 今後やりたいこと

現状 `User[]` のときに `User` を展開することができないので、ここを展開できるようにしたいですね

あと、選択先(ユーザーが選択する要素)が少ないので、増やしたいです

## おまけ

この型にいれると展開済みの型みれるみたいだよ

---

```ts
export type Node = {
  id: Scalars["ID"]
  parent?: Maybe<Node>
  children: Array<Node>
  internal: Internal
}
```

自分を参照するような型はダメっぽい？

## 参考

- [Using the Compiler API · microsoft/TypeScript Wiki · GitHub](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API)
