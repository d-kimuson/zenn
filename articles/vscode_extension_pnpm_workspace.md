---
title: "VSCode拡張機能開発でpnpm workspace化をしようとしたら壁が高かった"
emoji: "😐"
type: tech
topics: ["typescript", "vscode", "pnpm"]
published: true
---

私が開発している [ts-type-expand](https://github.com/d-kimuson/ts-type-expand) という拡張機能では、以前は yarn workspace を使ったモノレポ構成を取っていましたが、今回 pnpm workspace に移行することにしました。

つまりどころが多かったので知見を共有します。

## 基本的な移行方法

ロックファイルを移行するには以下のコマンドを使います。

```bash
$ pnpm import
```

これで、yarn.lock の内容を pnpm-lock.yaml に変換できます。

あとは

- yarn の設定ファイルを削除
- pnpm-workspace.yaml を作成し、ワークスペース指定を移す

等すればパッケージの依存管理については移行完了です。
pnpm は他のパッケージマネージャーよりモジュール参照が厳格なので問題が起きるケースもあると思いますが、本エントリの主題とはそれるため他の記事に譲ります。

## 制約: vsce コマンドでは pnpm がサポートされていない

拡張機能をパッケージングするには vsce コマンドを使用する必要がありますが、npm/yarn のサポートのみで pnpm がサポートされていません。

https://github.com/microsoft/vscode-vsce/issues/421

こちらの Issue で議論されています。

具体的には

```bash
$ vsce package
```

を実行すると、dependencies に記載されている依存関係が npm の形式で node_modules 以下に存在しないためエラーが発生します。
Issue を追うと pnpm の公式対応が行われないとのことです。

回避方法として、バンドラを使って dependencies をバンドルし `vsce package` の `--no-dependencies` オプションを使う方法が紹介されています。

ちなみに、`--no-dependencies` オプションを指定すると .vscodeignore の設定にかかわらず、node_modules 以下はパッケージングされないのでバンドルは必須になります。

## パッケージをバンドルする

バンドルには esbuild を使うこともできますが、tsup をおすすめします。
単一パッケージの場合、型定義は不要ですが、複数パッケージの場合は型定義を出力したいケースもあるでしょう。tsup なら型定義も1コマンドで出力できます。

ちなみに

https://github.com/microsoft/vscode/issues/130367

こちらの Issue で議論されてはいますが現時点で、VSCode の拡張機能は ESM に対応しておらず、`"type": "commonjs"` なパッケージとして用意する必要があります。ですので、出力形式は `commonjs` を設定します。

```bash
$ pnpm add -D tsup
```

```ts:tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['./src/extension.ts'],
  dts: false, // 他から参照されないので不要
  sourcemap: 'inline',
  target: 'node16',
  format: ['cjs'],
  tsconfig: 'tsconfig.json',
  external: ['vscode'],
  outDir: 'dist',
  clean: true,
  minify: true,
})
```

## Language Service Plugin のために node_modules が必要だった

`ts-type-expand` では、組み込みの tsserver から TypeScript の型情報を受け取るために [Language Service Plugin](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin) を使用しています。基本的なモジュール参照であれば上記のバンドルで対応できますが、Language Service Plugin は package.json に以下のように指定することで、node_modules からパッケージが読み込まれる仕組みになっています。

```json:package.json
{
  "contributes": {
    "typescriptServerPlugins": [
      {
        "name": "ts-type-expand-plugin",
        "enableForWorkspaceTypeScriptVersions": true
      }
    ]
  }
}
```

このようなケースでは、バンドルでは対応できません。

そこでかなり力技になりますが、拡張機能のコピーとなる一時的なパッケージを作成し、dependencies を ts-type-expand-plugin のみに書き換えることで対応しました。

具体的な処理は以下です。

```bash
#!/usr/bin/env bash

set -eux

REPOSITORY_DIR=$(git rev-parse --show-toplevel)
EXTENSION_TMP_DIR=${REPOSITORY_DIR}/extension-tmp # vsce package するための一時ディレクトリ
VERSION=$1

cd ${REPOSITORY_DIR}

# 全体ビルド
pnpm build

# workspace に属さない一時パッケージにローカルの ts-type-expand-plugin をインストールできるように pack する
pushd ./packages/ts-type-expand-plugin
ts_type_expand_plugin_packed=$(pnpm pack --pack-destination ${EXTENSION_TMP_DIR})
popd

# vsce package するときに他の dependencies があるとエラーになってしまうので
# dependencies, devDependencies のセクションを空にした package.json のコピーを用意する
node -e "console.log(JSON.stringify({...require('./packages/ts-type-expand/package.json'), scripts: {}, dependencies: {}, devDependencies: {}, version: '${VERSION}'}, null, 2))"\
  >> ${EXTENSION_TMP_DIR}/package.json

# パッケージングに必要なリソースのみコピーしてくる
cp ./packages/ts-type-expand/.vscodeignore ${EXTENSION_TMP_DIR}
cp ./packages/ts-type-expand/LICENSE ${EXTENSION_TMP_DIR}
cp -r ./packages/ts-type-expand/dist ${EXTENSION_TMP_DIR}

# pack した ts-type-expand-plugin をローカルインストール
pushd ${EXTENSION_TMP_DIR}
npm i $ts_type_expand_plugin_packed
pnpm vsce package --no-yarn
```

一部省略していますが、ポイントは以下の通りです。

- pnpm workspace に属さない一時パッケージにインストールするため ts-type-expand-plugin もバンドルし、pack しておく
- package.json を拡張機能のパッケージからコピーし、dependencies, devDependencies を空にしてから pack したプラグインを npm install する
- `pnpm vsce package --no-yarn` することで ts-type-expand-plugin のみ node_modules を持ち、他の dependency はバンドルされた状態でパッケージングできる

```:作成されたパッケージの中身
- dist
  - extension.js <-- Language Service Plugin 以外の依存はバンドルされている
- node_modules
  - ts-type-expand-plugin <-- 唯一必要なパッケージ
```

という感じで対応できました。

その他、バンドルが難しいモジュールがある場合等も同様に対応はできると思いますが、見ての通り大変なので node_modules が必要になるなら強い思い入れがなければ pnpm 以外のパッケージマネージャーの使用をおすすめします。

(じゃあなんで使っているのかというとその思い入れがあったからなんですが...)

## まとめ

VSCode 拡張機能開発において pnpm を使う方法を紹介しました！

- 公式のサポートはないものの、特殊なケース以外ではバンドルするだけで基本は動かすことができます
- バンドルが難しいパッケージがある場合や Language Service Plugin を使う場合は力技が必要となり大変ではあるが、一時パッケージを作ることで対応はできる(オススメはしない)

という感じでやや手間ではありますが VSCode 拡張機能開発でも pnpm を利用することができます！
pnpm は素晴らしいので多少コストがかかっても使いたいという人はぜひ移行してみましょう！

それでは以上になります。
