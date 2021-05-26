---
title: "TypeScript の型情報を展開して見やすくする VSCode 拡張機能を作った"
emoji: "🌟"
type: "tech"
topics: ["TypeScript"]
published: true
---

TypeScript の読みにくい型を展開して読みやすくする拡張機能を作りました！

## 動機

TS を書いてると型が読めないから、変数に束縛して補完で探ってが必要なことが度々あって、展開した型をみれるなにかがないかなーと思っていました

TypeScript の [CompilerAPI](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) なるものを知ったので、いい感じに型を抜き出して VSCode のツリービューに渡せば良いじゃんって思って調べてみたら同じ試みをされてる方がいらっしゃったのですが、残念ながら断念されてました

[type-explorer がポシャった話 - sisisin のブログ](https://sisisin.hateblo.jp/entry/2020/09/12/174228)

端的に言うと、compilerAPI の API が充実してないから逐次展開するみたいなことはできないそうで

ただ、拡張機能開発もやってみたかったというのもあったので、とりあえずダメ元で作ってみたら割と良い感じになったので公開しました

## 作ったもの

TypeScript の型定義を展開できる拡張機能です

[ts-type-expand - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kimuson.ts-type-expand) からインストールできます

![](https://storage.googleapis.com/zenn-user-upload/8kr3n3tx3ymlfxzg992z1u8ud3kw)

こんな感じで読みにくい型を VSCode 上で必要なだけ展開して確認することができます

画像は GraphQL スキーマから自動生成したものなので極端な例ですが、変数をホバーしてみたら `Partial<User>` って書いてあったけど `User` ってなんやねん、みたいなことは割とあると思うのでそういうときに使えます

対応している型については、型の解決は CompilerAPI がしてくれているので TS がサポートしていれば全て展開できるはずです

リポジトリは [d-kimuson/ts-type-expand: vscode extension for expand type of typescript](https://github.com/d-kimuson/ts-type-expand) です

## How To

[CompilerAPI](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) で VSCode 上で選択しているノードの型情報を取り出して、ツリービューに渡しています

CompilerAPI については

- [Using the Compiler API · microsoft/TypeScript Wiki · GitHub](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API#using-the-type-checker)
- [TypeScript の compiler API をいじる - asterisc](http://akito0107.hatenablog.com/entry/2018/12/23/020323)
- [TypeScript Compiler API の基本的な使い方、コード例と作ってみたもの \| Web 猫](https://katashin.info/2018/02/24/221)

この辺りの資料を参考にさせて頂いて基本的な使い方を覚えつつ、あとは手探りで型を取り出して行きました

Union 型を受け取るときに必要な型が提供されてなかった(実態は存在するけど型定義がなかったので手探りでプロパティを見つけて使うしかなかった)りとか、あまり資料が充実していなくて欲しい型の取り方が分からなかったりと結構大変でしたが、愚直にコネコネして取れるようにしました

## Tree View API

取り出した型は [VSCode の TreeView](https://code.visualstudio.com/api/extension-guides/tree-view) で展開しています

こちらは結構 API がシンプルだったので、あまり苦労せずに作れました

ただ、型を広げたいシチュエーションって

- プロパティを見たい
- Union の候補をみたい
- Enum の候補をみたい
- 関数の展開(引数と戻り値)

等、結構パターンが有るのに見た目的にはすべて折りたたまれているものを展開するだけなので、使ってみると「展開できることは把握できるが、なにを展開できるのか・しているのかが分からない」って感じで体験が微妙でした

少しいじってみたら `TreeItem` に `description` を設定してやると

![](https://storage.googleapis.com/zenn-user-upload/kfeg8zn69gg1qv3ra6c706l653et)

こんな感じで、付随する情報を出せることが分かったので、どういう意味合いで展開できるのか把握できるようにしました

## 詰まったこと

### 再帰的な型を使えない

最初は CompilerAPI でコネコネして完全に展開された型をツリービューに渡してたのですが、再帰的な型だと当たり前ですが無限ループに入ってしまいます

```ts
type User = {
  friend: User
}
```

パフォーマンス的にも逐一展開したほうが無駄な計算をしなくて済むしってことで、ツリービューの展開処理のタイミングで必要なプロパティだけ取得する形に修正しました

### 公開すると手元で動いたのに、動かなくなる

手元ではちゃんと動いているのに、公開してインストールしてみると組み込みの型が使えなくなっていました

```ts
type Foo = Array<string>
type Bar = Pick<Hoge, "key1", "key2">
```

こういうのが軒並みダメで。

結論から言うと `.vscodeignore` で必要なファイルを削ってしまっていたのが原因でした

`$ yo code` で作成される TypeScript の雛形をほぼそのまま使ったんですが、`.vscodeignore` で `*.ts` を送らないような初期設定になってました

一般的な拡張だと JS だけ送れば良いので親切に指定してくれていたみたいですが、今回の場合は `CompilerAPI` が型を解釈する時に node_modules 下にある組み込みの型定義を参照するので、`ignore` から外す必要がありました

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

## 今後やりたいこと

作ってみたら結構便利で、自分で使いたいので機能を充実させていこうと思っています

現状、配列の型展開(`User[]` のときに `User` を展開)ができないので、ここを展開できるようにしたいのと、カーソルの選択先が少ないので、増やしたいです

一番多いユースケースは、「使用されている変数から型情報を取り出して展開する」だと思いますが、現状だと変数宣言からしか展開できないのでこの辺をサポートしつつ、関数の引数とか、対応する場所を増やしたいです

拙いですが、よかったら使ってみてください！

[ts-type-expand - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kimuson.ts-type-expand)

## 参考

- [type-explorer という TypeScript の型を展開・閲覧出来る VSCode 拡張を作っている - sisisin のブログ](https://sisisin.hateblo.jp/entry/2020/08/12/005305)
- [TypeScript の AST・コンパイラ API とお付き合い - Qiita](https://qiita.com/sisisin/items/eac8381563097334c4e2)
- [Using the Compiler API · microsoft/TypeScript Wiki · GitHub](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeScript の compiler API をいじる - asterisc](http://akito0107.hatenablog.com/entry/2018/12/23/020323)
- [TypeScript Compiler API の基本的な使い方、コード例と作ってみたもの \| Web 猫](https://katashin.info/2018/02/24/221)
