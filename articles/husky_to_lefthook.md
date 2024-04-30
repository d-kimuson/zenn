---
title: "husky+lint-stagedからlefthookに乗り換えたので違いとか使えそうな設定とかまとめる"
emoji: "😽"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["Git", "lefthook"]
published: true
---

husky+lint-staged の構成の代わりとして気になっていた lefthook を試してみたら良い感じで乗り換えたのでメモついでに共有します。

## lefthook is 何？

> The fastest polyglot Git hooks manager out there

書いてあるとおり Git hooks の管理ツール。

Node.js 周辺ツールとしてはそこそこ有名な husky + lint-staged の構成を使うことが多かったけど、lefthook は husky でできること(フックをコミット対象の場所に置いてプロジェクトで共通のフックを使える) と lint-staged でできること(staged になっているファイルのみに linter をかける) の両方の責務を持っています。

## husky+lint-staged との違い

- lefthook は「プロジェクトで共通のフックを使う」ことを可能にした上で個人設定でその内容を上書きできる
  - ex. コミット前に linter を回すかは好みが分かれるので嫌だと思う人は外せる
  - ex. チームのみんなはいらなそうだけど自分だけ使いたいフックを追加する、ができる
- Go で書かれてるから高速なのと、シングルバイナリで動くので node 以外のエコシステムで使いやすい

(自分が Node.js 周りをよく使うので)後者は割りとどうでも良かったんですが、前者がとても良いなと思ったのが乗り換えの決め手です。

個人的には

- 自動整形とかはエディタの責務だと思いつつ、エディタの自動整形ってちょいちょい壊れて安定してないのでコミット時に自動修正書けて欲しい(エディタをすり抜けた時用)
- そういう設定ができないメンバーのフォローにもなる

ので基本欲しいと思ってますが、コミットにかかる時間が伸びるほうが嫌という人も観測するので推奨構成としてプロジェクトに起きつつ、嫌な人は避けられる状態が理想的かなと思っています。lefthook であればこれが実現できます。

## husky で lefthook と同じことができる未来は(たぶん)来ない

npm trends で見ると husky の方がかなり使われて入るので今後に期待でも良いんですが、結論から言うと husky で同じことができる未来は望み薄なのでは？と思っています。

以前にプロジェクトの husky を設定したときにまさに個人設定噛ませられないかなーと調べていたことがありたまたま知ってたんですが

- `core.hooksPath` (hooks が読まれるディレクトリ)はグローバル設定を含めても複数箇所設定できない

という制約があるので、`pre-commit` みたいなファイルを直接書かせたりする husky とか simple-git-hooks のアプローチで複数のエントリーポイントのサポートは基本的にできないです。

無理やりやるなら

```bash
call-local-hook() # 個人設定ディレクトリを見に行ってファイルがあれば実行

pnpm lint-staged # 共通部分
```

みたいな形を取るしか無いです。

で、プロジェクト共通のフックがあるものはそれでも良いんですが「プロジェクト設定はなし、個人設定はあり」みたいなパターンのサポートも考えると `.husky` 以下にすべてのフック

```bash:この辺
➜ ls .git/hooks/ | sed s/.sample//
applypatch-msg
commit-msg
fsmonitor-watchman
post-update
pre-applypatch
pre-commit
pre-merge-commit
pre-push
pre-rebase
pre-receive
prepare-commit-msg
push-to-checkout
update
```

のファイルを用意して、ローカルがあれば実行するだけのファイル

```bash:こんな感じ
call-local-hook() # 個人設定ディレクトリを見に行ってファイルがあれば実行

# 全体で実行するものはない
```

として書きだして置く必要が出てきます。
これだと大量の使わないフックスクリプトがコミット対象として置かれて見通しも悪いし、使わないフックまで毎回発火してしまいます。
また、これで頑張ってもあくまで「個人設定も追加」できるだけで、プロジェクトのフックの無効化は結局できないことになります。

てことで「プロジェクト設定と個人設定を共存させる」をしたいなら `core.hooksPath` 自体はコミット対象にせず、なんらかの独自フォーマットで書かせてから `core.hooksPath` にフックのスクリプトを自動生成するのがスジが良いやり方で、アプローチが根本的に違うから husky での実現は望み薄なのでは？と思っています。

(※だから husky が悪いということではないです。逆にいえば個人設定で上書きできないことは husky の利点にもなると思います。)

## てことで設定する

```bash
$ pnpm i -D lefthook
```

husky と違って `core.hooksPath` を書き換えてコミット対象にするわけではないので特に husky install 的なものを postinstall に置く必要はないっぽいです。あとは `lefthook.yml` に

```yaml:lefthook.yml(公式ドキュメントよりコピー)
pre-commit:
  commands:
    frontend-linter:
      run: yarn eslint {staged_files}
    backend-linter:
      run: bundle exec rubocop --force-exclusion {all_files}
    frontend-style:
      files: git diff --name-only HEAD @{push}
      run: yarn stylelint {files}
```

こんな感じで置いてあげるとフックが発火するようになります。

## とりあえず設定してみたもの

### prettier

```yaml:lefthook.yml
pre-commit:
  parallel: true
  commands:
    prettier:
      glob: '*.{tsx,ts,mts,mcs,mjs,cjs,js,json,md,yml,yaml}'
      run: |
        pnpm prettier --write --ignore-unknown {staged_files}
      stage_fixed: true
      skip:
        - merge
        - rebase
```

- lint-staged と違って勝手に git add してくれないので明示的に stage_fixed オプションを使って有効化する必要がある
- add までするのかは好み分かれるかもしれないが、個人的には自動整形可能なものは eslint も prettier も基本的にはコードの意味には影響を与えず、行儀を良くするものがほとんどなので裏で修正していても良いと思うので追加している
- merge・rebase するときにはほぼ無意味な大量のファイルにも prettier がかかってしまいオーバーヘッドが大きいので無効にしている
  - prettier の設定値が変わったり、コンフリクトを解消したりすると実際には prettier をかけたほうが良いケースもあるが、9割型のケースでは時間の無駄になってしまうので飛ばしている。

### eslint

```yaml:lefthook.yml
pre-commit:
  parallel: true
  commands:
    eslint-sample-package:
      root: 'packages/sample/'
      glob: '*.{tsx,ts,mts,mcs}'
      run: |
        pnpm --filter sample exec eslint --fix {staged_files}
      stage_fixed: true
      skip:
        - merge
        - rebase
```

- monorepo を想定してパッケージごとに書いたが、monorepo でないなら素直にルートに書いてあげれば良いだけ
- lint-staged だと js で設定がかけるからここを動的に組み立てることもできてその点に関しては lint-staged に優位があるなとは思った
  - lefthook が嬉しいのは「プロジェクト設定と個人設定の共存」だと思っているので差分実行に関して lint-staged に任せちゃうのもアリかなとは思った

### cspell

```yaml:lefthook.yml
pre-commit:
  parallel: true
  commands:
    cspell:
      glob: '*.{tsx,ts,mts,mcs,mjs,cjs,js,json,md,yml,yaml}'
      run: pnpm cspell lint --gitignore --cache {staged_files}
```

- cspell を使って辞書にない単語(タイポの可能性がある)がコミットされそうになったら止める

### prepare-commit-msg

```yaml:lefthook.yml
prepare-commit-msg:
  parallel: true
  scripts:
    'commitizen.sh':
      interactive: true
      runner: sh
```

```bash:commitizen.sh
#!/usr/bin/env sh

first_line=$(head -n1 $1)
if [ "${first_line}" != "" ]; then
  exit 0
fi

exec < /dev/tty && node_modules/.bin/cz --hook || true
```

- commitizen は対話形式でコミットメッセージを作れるくん。
- `interactive: true` を設定することでユーザー入力が必要な場合も問題なく動く
- シェルスクリプトが必要な今回みたいなケースでは commands ではなく scripts が使える

commitizen の設定については最近記事を書いたので割愛します。

https://zenn.dev/kimuson/articles/commitizen_custom_rule

### commit-msg

```yaml:lefthook.yml
commit-msg:
  parallel: true
  commands:
    spell-check:
      run: pnpm cspell --no-summary {1}
```

- 上で登場した cspell を使ってコミットメッセージにタイポがないかを検査する
- `{1}` の表記で hooks が受け取る引数も利用できる
  - 参考: https://github.com/evilmartians/lefthook/blob/master/docs/configuration.md#git-arguments

### audit

```yaml:lefthook.yml
pre-push:
  parallel: true
  commands:
    packages-audit:
      run: pnpm audit
```

- push 前に脆弱性のあるパッケージがないか検査する

## 個人設定で使いたくないフックをスキップする

冒頭で書いたように一部の不要なフックを ignore できるのが lefthook の良い点です。
上書きするには `lefthook-local.yml` を用意して skip フラグを建ててあげます。
例として prettier を無効にした場合には

```yml:lefthook-local.yml
pre-commit:
  commands:
    prettier:
      skip: true
```

参考: https://github.com/evilmartians/lefthook/tree/master#local-config

## まとめ

- husky+lint-staged から lefthook に乗り換えたのでよく使いそうな設定だったりを紹介しました
- lefthook の良いところは「プロジェクト設定と個人設定の共存ができる」ことなのでこの柔軟性がほしければ lefthook, 個人設定で無効化したりをしてほしくなければ husky というのが一つの選択基準になりそうです
- lefthook に lint-staged のスコープも含まれていますが、lint-staged だと設定を js で動的に組めるので、例えば「すべての packages, apps 以下で eslint を実行」みたいな書き方もできるため、必要に応じて lefthook+lint-staged もありそう
  - 逆に minimum に動くだけで良いなら lefthook 単体で staged なファイルのみに linter をかけるも実現できて良きです

以上になります！
ありがとうございましたー
