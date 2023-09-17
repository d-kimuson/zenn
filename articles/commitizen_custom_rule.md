---
title: "commitizen でチームの規約を作って対話型でコミットメッセージを作ると良い感じ"
emoji: "🔥"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: []
published: true
---

対話形式でコミットメッセージを作れる commitizen で独自の規約を設定するのが良い感じだったので紹介します！

## commitizen is 何

[GitHub - commitizen/cz-cli: The commitizen command line utility. #BlackLivesMatter](https://github.com/commitizen/cz-cli)

commitizen は対話形式でコミットメッセージを作成できるツールです。

`feat`/`fix`/`doc`...etc 等の予め決められたラベル、スコープ、メッセージ本文、の流れで選択して行くことで

```text
feat(frontend): implement search feature!
```

こんな感じのメッセージを作ることができます。

規約通りにコミットメッセージを書いてもらうのに便利で、commitlint 等で規約に沿わないものを弾くのもアリですが、個人的には自動的に規約に則ったメッセージが修正する手間が発生しないので良いかなと思っています。[^1]

[^1]: GUI からコミットメッセージを作る場合には対応できないので、そういうケースでも規約を守らせたいのであれば commitlint (または併用)のほうが適しているかもしれません。

## まずは cz で直接実行する

```bash
$ pnpm i -D commitizen cz-conventional-changelog
```

でインストールできます。commitizen が cli のツールで cz-conentional-changelog には conventional-changelog の規約の設定が入っています。

インストールしたら commitizen で使用する規約を教えて上げる必要があるので package.json に config を追加します。

```json:pakage.json
{
  // ...
  "config": {
    "commitizen": {
      "path": "./node_modules/cz-conventional-changelog"
    }
  }
}
```

あとは `pnpm cz` で対話が始まるので答えていくことでコミットメッセージを作ることができます。

```bash
$ pnpm cz
cz-cli@4.3.0, cz-custom-rule@1.0.0

? Select the type of change that you're committing: feat:     A new feature
? What is the scope of this change (e.g. component or file name): (press enter to skip) sample
? Write a short, imperative tense description of the change (max 86 chars):
 (15) add new feature
? Provide a longer description of the change: (press enter to skip)

? Are there any breaking changes? No
? Does this change affect any open issues? No

[main 90fb7ad] feat(sample): add new feature
 1 file changed, 0 insertions(+), 0 deletions(-)
 create mode 100644 tmp
```

こんな感じですね。コミットまで作成されます。

## 独自の規約を作る

さて、conventional-changelog も規約として良いと思いますがこれは元々 OSS とかで CHANGELOG を自動生成したり、SemVer 運用の文脈が強いと思っており、一般的な Web 開発の規約としては適していないケースもあると思います。

ので、プロジェクトに合わせて独自の規約を作り commitizen でコミットできるようにしていきます。

モノレポ構成であれば専用のパッケージを追加してそこに設定を書いていきます。

```bash
# packages/cz-custom-rule
$ pnpm add cz-conventional-changelog
```

```json:package.json
{
  "name": "cz-custom-rule",
  "description": "プロジェクト用のcommitizenカスタムルール",
  "private": true,
  "version": "0.0.1",
  "main": "index.cjs",
  "dependencies": {
    "cz-conventional-changelog": "^3.3.0"
  }
}
```

index.cjs に設定を書いていきます。
今回は仮でシンプルに新機能・仕様変更・リファクタリングの 3 つのラベリングができる規約を用意してみます。

```js:index.cjs
// @ts-check
const engine = require('cz-conventional-changelog/engine')

/** @typedef {{ title: string, description: string, emoji?: string } } CommitType */

// ref: https://github.com/pvdlg/conventional-commit-types/blob/master/index.js#L93
/** @type {{ [K: string]: CommitType }} */
const commitTypes = {
  機能追加: {
    description: '新しい機能を追加するときに使いましょう！',
    title: '機能追加',
    emoji: '✨',
  },
  仕様変更: {
    description: '既存の機能の使用を変更するコミットに使います！',
    title: '仕様変更',
    emoji: '📚',
  },
  リファクタリング: {
    description: '仕様に変更が入らない状態でコードを改善するときに使います！',
    title: 'リファクタリング',
    emoji: '📦',
  },
}

module.exports = engine({
  types: commitTypes,
  // config この辺の設定もよしなに
  defaultType: undefined,
  defaultScope: undefined,
  defaultSubject: undefined,
  defaultBody: undefined,
  defaultIssues: undefined,
  disableScopeLowerCase: undefined,
  disableSubjectLowerCase: undefined,
  maxHeaderWidth: 100,
  maxLineWidth: 100,
})
```

これでカスタムルールを作成することができました。

あとはワークスペースルートの package.json に依存を追加して、commitizen の path 設定を向けてあげます。

```json:pakcage.json
{
  "config": {
    "commitizen": {
      "path": "./node_modules/cz-custom-rule"
    }
  },
  "devDependencies": {
    "cz-custom-rule": "workspace:*"
  }
}
```

これで独自の規約で対話的にコミットメッセージを作れるようになりました！

```bash
$ pnpm cz
? Select the type of change that you're committing: (Use arrow keys)
❯ 機能追加:     新しい機能を追加するときに使いましょう！
  仕様変更:     既存の機能の使用を変更するコミットに使います！
  リファクタリング: 仕様に変更が入らない状態でコードを改善するときに使います！
```

今回は pnpm workspace のモノレポ構成が前提で説明しましたが、他の workspace でも同様ですし、モノレポでなくても設定用の index.cjs を用意して直接参照させてあげれば問題なく動くはずです。

## フックで実行する

`pnpm cz` でコミットメッセージを自動生成できるようになりましたが、このやり方は husky 等で行う lint-staged 系の仕組み(つまりコミット前に linter を通す)との相性が良くないです。

具体的には、最初に対話が走ってコミットメッセージを考えてから linter が実行されることになるので、linter で問題が見つかってしまうと対話で入力したコミットの説明が入力し直しになってしまうのです。

ですので、これ系の仕組みを使っている場合は prepare-commit-msg にフックとして差し込んであげるのがオススメです。公式ドキュメントを参考に

```bash:prepare-commit-msg
#!/usr/bin/env sh

exec < /dev/tty && node_modules/.bin/cz --hook || true
```

こういうフックを prepare-commit-msg に入れてあげます。

これにより

```bash
$ git commit
```

すると git hooks が発火して lint-staged 等でリンターを回してから成功したら対話が始まる、という形を実現できるようになりました。この流れであればコミットメッセージを再入力しなければいけないことはないので体験が良いです。

### amend や merge で実行しない

上の例でフックを紹介しましたが、このフックは amend のコミットや merge コミットでも発火する挙動をします。

ここは好みですが、個人的には

- amend は既存のコミットメッセージを微修正したり、コミットメッセージは変えないまま差分を追加したりという感じで改めてコミットメッセージは作ってほしくない
- マージコミットもデフォルトのメッセージで良いので作ってくれなくて良い

と感じるので

```bash
#!/usr/bin/env sh

# amend や merge commit では発火させない
first_line=$(head -n1 $1)
if [ "${first_line}" != "" ]; then
  exit 0
fi

exec < /dev/tty && node_modules/.bin/cz --hook || true
```

こんな感じでバリデーションを書いてあげて無効にしています。

## まとめ

- コミットメッセージの規約を整えるのに commitlint も良いけど対話型で書かせるのも一つの選択肢になりそうです
  - ※ もちろん併用も
- 規約をプロジェクトで独自設定することもできます
- git hooks で commit 前に linter 等回している場合は cz ではなく prepare-commit-msg フックでつなぎこむのがオススメです

以上になります。
ありがとうございました！
