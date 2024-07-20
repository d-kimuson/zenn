---
title: "TypeSpec が OpenAPI や JSON Schema を書くのに良かったので紹介する"
emoji: "😤"
type: tech
topics: ["typespec", "openapi", "API", "JSON"]
published: true
---

# TypeSpec が OpenAPI や JSON Schema を書くのに良かったので紹介する

冗長になりがちで書くのが大変な OpenAPI や JSON Schema を型付きで体験よく記述できる TypeSpec を紹介します。

## きっかけ

SwitchBot の API を利用したくて OpenAPI のスキーマが提供されていないか調べていたんですが、[SwitchBot の API ドキュメント](https://github.com/OpenWonderLabs/SwitchBotAPI) は Markdown で記述されており、残念ながら OpenAPI から クライアントのコード生成等はできませんでした。

そこで、ドキュメントから OpenAPI のスキーマに起こしていこうかなと思ったんですが、OpenAPI Schema を一から書くのは割と大変なので、TypeSpec を使ってみたらかなり使い勝手が良かったので紹介します。

## TypeSpec とは

[TypeSpec](https://typespec.io/) は、Microsoft が開発している API 等のスキーマ定義用の言語です。公式の説明を見てみると：

> TypeSpec はクラウドサービスの API とその形状を定義するための言語である。 TypeSpec は、REST、OpenAPI、gRPC、その他のプロトコルに共通する API 形状を記述できるプリミティブを持つ、拡張性の高い言語である。(DeepL にて翻訳)

と書かれています。
この記事では主に OpenAPI を記述するために書くことが目的ですが、単に JSON Schema だったり、gRPC だったりのスキーマ定義にも利用できるらしいです。

書き心地が TypeScript にかなり近くて、一言でいうと「TypeScript でスキーマ定義を記述したらトランスパイルして OAS を吐いてくれる君」という感じです。

TypeScript が JS にトランスパイルされるのとちょうど同じように TypeSpec で記述したスキーマ情報は OpenAPI スキーマとして書き出されます。

## なにがうれしいか

まず前提として、API のスキーマ定義の方法として OpenAPI は表現力が高く、かなり正確にスキーマを記述できます。

components を使ったオブジェクト単位での抽象化も提供されますし、冗長ではありますが oneOf, anyOf を使ったユニオン型の表現、allOf を使った交差型(あるいは継承)の表現も可能です。

しかし、表現力は十分なんですが、記法がかなり冗長になっていて人が生で書くのはかなり厳しいです。

例えば

```typescript
// typescript のコード
type NormalUser = {
  id: string
  name: string
}

type SuperUser = NormalUser & {
  role: "owner" | "manager"
}

type User = NormalUser | SuperUser // これをレスポンス型として使いたい！
```

みたいな表現をしたいとして、OpenAPI(JSON Schema) で記述しようと思うと

```yaml
components:
  schemas:
    NormalUser:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
      required:
        - id
        - name
    SuperUser:
      type: object
      properties:
        role:
          type: string
          enum:
            - owner
            - manager
      allOf:
        - $ref: "#/components/schemas/NormalUser"
    User:
      oneOf:
        - $ref: "#/components/schemas/NormalUser"
        - $ref: "#/components/schemas/SuperUser"
```

上記のような書き方になります。

開発者が考えた型を表現するのが割と面倒なことに加えて、定型的な記述が多く、ファイル分割もできないので問題に気づきにくかったりといったペインがあります。

その点 TypeSpec を利用すると、この辺りの面倒を TypeSpec が見てくれるので開発者は「API の仕様を記述する」という本来やりたかったことに集中できます。

実際、このモデルを表現する TypeSpec のコードは TypeScript でのコードとほぼ同じで

```tsp
model NormalUser {
  name: string;
  age: numeric;
}

model SuperUser extends NormalUser {
  role: "manager" | "owner";
}

alias User = NormalUser | SuperUser;
```

これで終わりで、JSON Schema で直接書いた場合よりもかなり直感的に書けることがわかります。

## 使い方を見てみる

この記事では、TypeSpec の環境構築等については触れず、どんな感じで書けるのかの紹介に留めます。
[公式ドキュメントの Getting Started](https://typespec.io/docs) と今回作成した SwitchBot API の OpenAPI Spec を書いたリポジトリを貼っておくのでそちらを参考にしてください。

TypeSpec の嬉しいところの 1 つとして [VSCode 拡張機能](https://typespec.io/docs/introduction/editor/vscode) がちゃんとできているところがあるのでインストールして使うのをオススメします。

さすが TypeScript, [Pylance](https://github.com/microsoft/pylance-release) を作っている Microsoft 謹製なだけあって実用的なレベルでしっかり動いていて驚きました。

型を利用した的確な補完が入ったり、静的解析で検知できる問題はエディタが怒ってくれたりするのでかなり書きやすいです。

今回使ったリポジトリはこちらです:

https://github.com/d-kimuson/switchbot-api-openapi

(記事の本筋とは関係ありませんが) SwitchBot API を使いたいけど、OpenAPI Spec がなくて困っている人も良ければぜひ使ってください。

## 書き方を見ていく

### model

冒頭でも軽く出していますが、データ構造を定義するには model を使います。

```tsp
model NormalUser {
  name: string;
  age: numeric;
}
```

model は継承することができて

```tsp
model SuperUser extends NormalUser {
  role: "manager" | "owner";
}
```

のように書けます。
リテラル型やその Union も TypeScript のように書けて便利です。

model で定義したものは OpenAPI 的には components に書き出され、extends は allOf によって表現されるようです。

```yaml
components:
  schemas:
    NormalUser:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
      required:
        - id
        - name
    SuperUser:
      type: object
      properties:
        role:
          type: string
          enum:
            - owner
            - manager
```

### 型エイリアス

model では or に相当する概念は表現できませんが、modelA or modelB のような記述は alias でできます。
alias はちょうど TypeScript の タイプエイリアス(`type`) と同じ使い勝手です。

```tsp
alias SampleObject = {
  name: string
};
alias User = NormalUser | SuperUser;
```

ここだけ見ると、model の上位互換に見えて alias だけ使っておけば良くね感がありますが、結論から言うとモデルはちゃんと model で書くのが良いです。

alias で定義したものは model と違って components に書き出されるわけではなく、コンパイル時に展開されます。

なので

- アノテーションをつけられないことがある
- [redocly](https://redocly.com/), Swagger 等でドキュメントに起こした際に名前情報を解決できない
  - model で書いていれば `NormalUser` or `SuperUser` のように表記されていたものが `object` 表記になってしまう

と言った制約があります。

```tsp
@doc("sample") // => Cannot decorate alias statement.TypeSpec(invalid-decorator-location)
alias Sample = {}
```

### ジェネリクス

TypeSpec の model や alias ではジェネリクスが使えます。

model と alias は(冗長ではあるものの)一応 OpenAPI でも表現できましたが、Generics 的な抽象化は OpenAPI ではそもそもできないのでこれが使えるのはとても嬉しいです。

Generics が便利なケースの1つとして、すべての API で共通になるレスポンス構造を定義するときに便利です。

```tsp
model BadRequestErrorResponse {
  @statusCode status: 400;
  @body body: {
    message: string;
  };
}

model SuccessResponse<T> {
  @statusCode status: 200;
  @body body: {
    data: T
  };
}

alias GetResponse<T> = SuccessResponse<T> | BadRequestErrorResponse;
```

のように宣言しておき

```tsp
GetResponse<{
  userList: Array<User>
}>
```

のように利用できます。

OpenAPI だと `BadRequestErrorResponse` 等をレスポンスのステータスコードとセットですべてのAPIで書かなければいけない(しかも割と定型的な記述が多くてめんどくさい！)んですが、ジェネリクスがあることで書くのもメンテナンスもかなり楽になります！

### API を定義する

一通りのスキーマを定義してみたので、これらの model 等を使って API を定義して OpenAPI として書き出してみます。

```tsp
import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http; // using すると TypeSpec.Http が展開されてそのまま生えている属性を参照できる

@service({
  title: "Example API",
})
@TypeSpec.OpenAPI.info({
  version: "1.0",
})
@server("https://api.exapmle.com/v1.0", "production")
@useAuth(
  [
    ApiKeyAuth<ApiKeyLocation.header, "Authorization">
  ]
)
namespace ExampleAPI;

@route("/users")
@tag("User")
namespace UserRoute {
  @summary("Get Users")
  @get
  op users(): GetResponse<{
    users: Array<User>
  }>;
};
```

これを tsp で変換すると

```yaml
openapi: 3.0.0
info:
  title: Example API
  version: "1.0"
tags:
  - name: User
paths:
  /users:
    get:
      tags:
        - User
      operationId: UserRoute_users
      summary: Get Users
      parameters: []
      responses:
        "200":
          description: The request has succeeded.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: object
                    properties:
                      users:
                        type: array
                        items:
                          anyOf:
                            - $ref: "#/components/schemas/NormalUser"
                            - $ref: "#/components/schemas/SuperUser"
                    required:
                      - users
                required:
                  - data
        "400":
          description: The server could not understand the request due to invalid syntax.
          content:
            application/json:
              schema:
                type: object
                properties:
                  message:
                    type: string
                required:
                  - message
security:
  - ApiKeyAuth: []
components:
  schemas:
    NormalUser:
      type: object
      required:
        - name
        - age
      properties:
        name:
          type: string
        age:
          type: number
    SuperUser:
      type: object
      required:
        - role
      properties:
        role:
          type: string
          enum:
            - manager
            - owner
      allOf:
        - $ref: "#/components/schemas/NormalUser"
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Authorization
servers:
  - url: https://api.exapmle.com/v1.0
    description: production
    variables: {}
```

このような形で OpenAPI Schema が書き出されてくれます。嬉しい！

### ファイル分割

OpenAPI ではファイル分割ができません。
ただの yaml なので勝手にファイルを分けて結合みたいなことはできますが、分割された状態で解釈させることはできません。(開発中にエディタのサポートも受けにくくなるのでつらいですね。)

その点、TypeSpec にはモジュールシステムがありファイルを分割しやすいのも嬉しいところです。

例として以下のような形で分割ができます。

```tsp:response.tsp
namespace Response;

// ...
alias GetResponse<T> = SuccessResponse<T> | BadRequestErrorResponse;
```

```tsp:main.tsp
import "./response.tsp";

@route("/users")
@tag("User")
namespace UserRoute {
  @summary("Get Users")
  @get
  op users(): Response.GetResponse<{
    users: Array<User>
  }>;
};
```

ApiTag ごとにファイルを分けたりできるので、メンテナンスしやすいのもありがたいです。

## 現時点で微妙だったところ

基本的にはかなり使い勝手が良かったんですが、気になる部分もなくはなかったので書いておきます。

### すべての問題を型エラーで検知できるわけではない

まず、OpenAPI を吐き出すだけなので吐き出せたらイコール valid なのかなと思ってたのですが、そうでもなく invalid なスキーマが書き出されることもあるようです。

なので、[redocly](https://redocly.com/) 等の OpenAPI の構造チェックをしてくれる linter は入れてチェックしたほうが良いです。(これは生で書くときも同じですが、TypeSpec を使っているからと言ってなくさないほうが良いという話です。)

### webhooks のサポートがない

一番困ったというか残念だったのがコレで、webhooks (OAS で webhook の飛んでくるリクエストのスキーマを書くところ) を記述する方法が見つけられなかったことですね。

SwitchBot の API では webhook を登録して任意の URL でリクエストを受け取れるんですが、TypeSpec で現状サポートされていないためそのスキーマを OpenAPI に起こすことができませんでした。

今回の私の用途的にはクライアントの生成ができればよく、私がリクエストを受ける側は割とどうでも良かった(OpenAPI で定義していてもその型を使ってハンドラーを書いたりはしない)のでクリティカルではなかったんですが、「自分たちが開発している API の仕様を TypeSpec 記述して公開しようとする」ようなケースだとちょっと困るなーと思いました。

他には特になかったですが、TypeSpec が OAS を吐き出すという構造上、**OAS がサポートしているが、TypeSpec がサポートしていない** ような書き方はありうるのでそこはネガティブなポイントだなと思いました。

(自分は今回そこまで踏み込んでいませんが)プラグイン開発はできるようでガイダンスも公式ドキュメントにあったので、自分で対応をすれば良い話ではありそうです。

## 終わりに

OpenAPI を比較的楽に記述できる TypeSpec について紹介しました！

スキーマファーストな開発をしていたり、コードファーストなアプローチで機械的に生成できず自前で OpenAPI Spec を書かなければいけないときにはとてもオススメなのでぜひお試しください！

余談なんですが、LLM が出てきてだいぶこういう作業が楽になったとはいえ HTML や markdown ベースのドキュメントを OpenAPI Spec (ないし、単に型定義) に起こすのはかなり面倒なので API を提供している各社さんにはぜひとも OpenAPI でドキュメンテーションを提供してほしいなと思いましたまる。。
