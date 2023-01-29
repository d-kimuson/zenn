---
title: "TypeScriptの型情報を扱うVSCode拡張機能をlanguage-service-pluginで軽量化した話"
emoji: "🚅"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["typescript", "compilerapi", "vscode"]
published: true
---

個人的に開発・メンテナンスしている TypeScript の複雑な型定義を展開表示できる VSCode の拡張機能 [ts-type-expand](https://zenn.dev/kimuson/articles/ts_type_expand) を軽量化したのでその手法を紹介します

内容としては拡張機能独自で建てていた CompilerAPI とウォッチャーを、VSCode 内蔵の [vscode.typescript-language-features](https://code.visualstudio.com/docs/languages/typescript) の CompilerAPI を使うようにした形です
このやり方を見つけるまでに苦労したので CompilerAPI を使うような拡張機能開発をしようとしている方の一助になれば幸いです

## 抱えていた問題点

[ts-type-expand](https://zenn.dev/kimuson/articles/ts_type_expand) は VSCode 標準の変数のホバーだと丸められてしまう

![](https://storage.googleapis.com/zenn-user-upload/95d064d20bfb-20230129.png)

こういう型定義を

![](https://storage.googleapis.com/zenn-user-upload/fa7a57c6d9ad-20230129.png)

こういった形で最終的に解決される型に展開して TreeView で確認できる拡張機能です

選択されている変数等の型情報を拡張機能側で拾う必要があり、これを実現するために [CompilerAPI を watch オプション](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#writing-an-incremental-program-watcher) で起動して、選択されたノードの型情報を解決・表示していました

しかし、型解決の処理は結構重くて (`tsc --noEmit` に処理を挟んで型情報を拾うイメージなので) 弱めのマシンだったり、大きな構成のプロジェクトでは拡張機能が重くなってしまって使い勝手が悪いという問題点がありました

また、VSCode には標準で TypeScript の型チェックやホバーでの型表示の機能が備わっていますが、VSCode で使われている tsserver とは別で型解決をしているため

- モノレポ等での複数の tsconfig.json を解決する手段を提供できていなかった
  - VSCode だと [Solution Style](https://angular.jp/guide/migration-solution-style-tsconfig) やディレクトリ構造を工夫することで読ませられるが、この拡張機能ではサポートできていなかった
- VSCode では ["typescript.tsdk": "node_modules/typescript/lib" を設定することで、プロジェクトにインストールされたバージョンの TypeScript を利用することができる](https://kamatimaru.hatenablog.com/entry/2021/01/04/110011) が、拡張機能ではサポートできていなかった
  - 拡張機能にインストールされている TypeScript 4.4 固定で型解決をしていたため、解決される型が実際と若干異なる可能性や、追加された構文で壊れる可能性があった
  - 例: プロジェクトの TS バージョンが異なることで、error の型が `any` -> `unknown` と誤解決されてしまったり、satisfies operator で壊れてしまったり
- 保存されているファイルベースで型解決を回すので、VSCode 上で入力されているが、まだ保存されていない型を対象にできない
  - ts-type-expand の主なユースケースは、「ホバーで不十分だったときに TreeView を確認する」であり、変数ホバーが保存されていないものも型解決して表示できる以上、拡張機能側も保存されていない部分も含めて解決されるのが理想的な挙動だった

と言った問題点がありました

## language-service-plugin を使う

上記のような構成を取っていたのは VSCode の tsserver に対してサードパーティの拡張機能から直接型情報等を受け取る手段が提供されていなかったからです

しかし

- VSCode 公式の typescript-language-feature には、configurePlugin という API が生えていて、任意の typescript の [language-service-plugin](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin) を有効化することができる
- language-service-plugin では任意の TypeScript で記述されたプログラムを、tsserver の起動時・設定変更時に走らせることができる

ため

1. 拡張機能を有効化したときに専用の language-service-plugin(以下、[ts-type-expand-plugin](https://github.com/d-kimuson/ts-type-expand/tree/master/packages/ts-type-expand-plugin) と呼びます) を有効化する
2. ts-type-expand-plugin が有効化されたときに [express](https://expressjs.com/ja/)^[便宜上、express としていますが HTTP が喋れれば何でも良いです双方向である必要があるなら websocket でも問題ないはずです] のサーバーを起動して、いくつかのエンドポイントを追加する
3. 拡張機能で選択されているノードが変更されるたびに、2 で起動したエンドポイントを呼び出し、HTTP レスポンスとして必要な情報(今回の場合は主に解決された型情報)を受け取る

という仕組みで CompilerAPI を利用することができます

実際のコードで説明します

拡張機能の activate 関数で

```typescript:exntesion.ts
import vscode from "vscode"
import getPort from "get-port"

const tsFeatureExtension = vscode.extensions.getExtension<
  TypescriptLanguageFeatures
>('vscode.typescript-language-features')>
await tsFeatureExtension.activate()
const tsApi = tsFeatureExtension.exports?.getAPI(0)

const port = await getPort({
  port: defaultPort // なんでも良いですが、ts-type-expand ではデフォルトポートをユーザーが settings.json で設定できるようにしています
})

tsApi.configurePlugin('ts-type-expand-plugin', {
  port,
})
```

こういう実装で ts-type-expand-plugin を有効化します

language-service-plugin は node_modules 以下に実態が存在する必要があるため、別の package として構成します npm に公開して install する等でも良いはずですが、開発体験も悪いですし、これを機に ts-type-expand では monorepo 構成へ移行しました

language-service-plugin は

```ts:index.ts
import type { PluginConfiguration } from "./schema"
import type { server } from "typescript/lib/tsserverlibrary"

const factory: server.PluginModuleFactory = (_mod) => {
  return {
    create(info): ts.LanguageService {
      /* plugin が有効化されたときの処理を書く */

      return info.languageService
    },
    onConfigurationChanged(config: { port: number }): void {
      /*
       * 設定が変更されたときの処理を書く
       * 設定 := プラグインの設定で、configurePlugin で指定している { port: number } のことです
       */
    },
  }
}

export = factory
```

が最小限の内容です

[Compiler API のドキュメント](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API#getting-set-up) にあるように型の拾い出し等の諸々の操作は `ts.Program` から行うことができて、language-service-plugin の create の引数 info からこちらを受け取ることができます

```ts
const program /* :ts.Program  | undefined */ = info.languageService.getProgram()
```

ので、諸々簡略化していますが、以下のような実装で VSCode 側と HTTP でやり取りできるようになります

```ts:./program.ts
import type { Program } from "typescript"
import type { server } from "typescript/lib/tsserverlibrary"

export const { setProgram, getProgram } = (() => {
  let createInfo: Program | undefined = undefined

  return {
    setProgram: (programUpdated: Program): void => {
      program = programUpdated
    },
    getProgram: (): Program | undefined => program,
  }
})()
```

```ts:index.ts
import express from "express"
import type { Server } from "http"
import type { server } from "typescript/lib/tsserverlibrary"
import { registerApp } from "./register-app"
import { setProgram } from "./program"

const factory: server.PluginModuleFactory = (_mod) => {
  let server: Server | undefined
  let start: ((port: number) => void) | undefined
  let isInitialized = false

  return {
    create(info) {
      setProgram(info.languageService.getProgram())

      if (isInitialized) {
        return info.languageService
      }

      const app = express()
      registerApp(app) // エンドポイントやミドルウェアの登録等拡張機能のロジックに関わるものを登録する

      start = (port) => {
        server?.close()
        server = app.listen(port)
      }

      isInitialized = true
      return info.languageService
    },
    onConfigurationChanged(config: { port: number }) {
      if (start === undefined) {
        console.error("BEFORE_INITIALIZE", {})
        return
      }

      /**
       * なんらかの問題で落ちたときに拡張機能側からのアクションで再起動できてほしいので
       * port 番号が変わらなくても毎回再起動する実装にしておく
       */
      start(config.port)
    },
  }
}

export = factory
```

エンドポイントは

```ts:./register-app.ts
import type { Express } from "express"
import { getProgram } from './program'

export const registerApp = (app: Express): void => {
  // middleware やエンドポイントを好きに追加する

  app.get('/example', (req, res) => {
    const program = getProgram()
    if (program === undefined) {
      throw new Error('初期化されていない！')
    }

    // program を使って実現したいロジックを書いて
    res.json({
      example: 'Hello World'
    })
  })
}
```

のような形で CompilerAPI を介した処理を VSCode 側に伝えるエンドポイントを追加できます

language-service-plugin の詳細については [公式の Wiki](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin) を参照してください

ちなみに今回は主題と逸れるので割愛しますが、型安全な HTTP 通信のために今回は tRPC を使いました

https://github.com/trpc/trpc

エンドポイントの数もたかが知れてますし、OpenAPI を手で書いたり、NestJS 等でスキーマを自動生成したりするほどゴリゴリな構成を組む必要性も薄いので、手軽に型安全なやり取りができて体験がとても良かったです

## 置き換えの結果

こちらの仕組み変更は [v1.0.0](https://github.com/d-kimuson/ts-type-expand/releases/tag/v1.0.0) としてリリースしました

仕組み変更の結果を紹介します

### 軽量化した

当初の一番の目的がこれでした

ベンチマーク等取ったりはしていませんが、単純に型解決を 2 重に行わなくなったので軽量になりました

大きめのプロジェクトを開くと体感できるレベルで軽くなっています

### tsconfig や TypeScript の実態の解決方法が VSCode 標準に沿うようになった

元々、ts-type-expand ではカスタムの tsconfig.json をサポートするために [ts-type-expand.tsconfigPath](https://github.com/d-kimuson/ts-type-expand/blob/v0.0.11/package.json#L34~L38) オプションを提供していました

しかし、今回のリリースで ts-type-expand 側でやることは組み込みの tsserver から `ts.Program` だけ受け取って処理をする形になったので、こちらのオプションが削除され、tsconfig の解決や tsserver を起動は VSCode 側の仕組みに乗ることができました

結果として

- monorepo 等の複数の tsconfig.json のサポートができるようになった
- CompilerAPI で使う TypeScript のバージョンもプロジェクトのバージョンを使うことができるようになった

という状態になりました

### OnType で型を反映できるようになった

tsconfig 解決の話と同様に、typescript-language-feature での保存されていない差分も型解決される仕組みに乗れるようになりました

ただこれの弊害もありまして、元々 `vscode.window.onDidChangeTextEditorSelection` イベントで TreeView に表示する型を変えていたのですが、これをそのまま使うと入力するたびにリクエストが走って拡張機能が固まったりするようになってしまいました

これに関しては入力で型を更新してほしいけど、実際に表示するものはマウスで選択するたびに更新できれば良く、`vscode.TextEditorSelectionChangeEvent` では Selection の変更の種類を `.kind` で取得できるため

```ts
if (e.kind !== TextEditorSelectionChangeKind.Mouse) {
  return // skip
}
```

のような処理を入れることで解決しました

## まとめ

language-service-plugin を使うことで、tsserver の compilerAPI を使う手法を紹介しました

こちらの手法では、直接 CompilerAPI を使うときに比べて

- 重複して型解決やウォッチの処理が走らないので軽量
- VSCode 標準の tsconfig 等の解決に相乗りできるので、手軽に高水準のサポートをしやすい

という利点があります TS の型情報に依存した拡張機能を制作する場合は、language-service-plugin を使った手法をまず検討できると良いと思います

また、ts-type-expand は機能的にはおすすめできるけど、拡張機能自体の安定性と複雑なプロジェクトで使いづらかったりという点で人に勧めづらかったんですが、今回の仕組み変更を持って人に進めやすくなりました！

良かったらこちらも使ってみてください！大きく仕組みが変わった後なので不具合報告などもいただけると嬉しいです

https://zenn.dev/kimuson/articles/ts_type_expand

## 参考

- [TypeScript-wiki/Using-the-Compiler-API.md at main · microsoft/TypeScript-wiki · GitHub](https://github.com/microsoft/TypeScript-wiki/blob/main/Using-the-Compiler-API.md)
- [Writing a Language Service Plugin · microsoft/TypeScript Wiki · GitHub](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin)
- [Standalone Server (tsserver) · microsoft/TypeScript Wiki · GitHub](https://github.com/microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29)
- [Provide more structured type information to editors via tsserver · Issue #46701 · microsoft/TypeScript · GitHub](https://github.com/microsoft/TypeScript/issues/46701)
