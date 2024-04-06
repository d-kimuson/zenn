---
title: "GitHub Actions ですべての CI の完了にフックして処理をする"
emoji: "🎃"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["githubactions"]
published: true
---

この記事は[株式会社エス・エム・エス Advent Calendar 2023](https://qiita.com/advent-calendar/2023/bm-sms)の22日目の記事です。

この記事では GitHub Actions にて PR のすべてのチェックが完了したタイミングで任意の処理（Slack 通知や、Draft 解除等）をする方法について紹介します。

## やりたいこと

チームによって細かな差異こそあれど、プルリクエストを作成したらマージ条件として CI の通過を必須としているケースは多いのではないでしょうか。

コードの品質を保つために有効な CI ですが、時間経過で肥大化して実行時間が長くなりがちです。
そしてワークフローによっては

- CI 通過 を確認してからレビュー依頼したい
- CI 通過を確認してから PR をマージしたい

というような理由で、長い時間 CI を待たなければいけないケースもあるでしょう。そういった際に CI が完了したかを開発者が何度も確認するのは生産的ではないので、CI の完了を検知して自動で処理を実行する方法を紹介します。

## 方針

ざっくり 2 方針考えられます。

1. すべてのワークフローが完了するまで wait する
2. 任意のワークフローが完了したタイミングで確認用のワークフローを動かし、すべて完了済みだったら処理を実行する（最後のワークフロー以外はなにもせず終了する）

前者は以下の記事で紹介されています。

[github-action-all-check-ci \| MIXI DEVELOPERS](https://mixi-developers.mixi.co.jp/github-action-all-check-ci-cad4d862f137)

ただすべてのワークフローが完了するまで wait するやり方だと GitHub Actions の GitHub Hosted Runner の課金はインスタンスの稼働時間に依存するため、すべて直列だと仮定すると単純計算で2倍、一部並列でもそれに近い比率で金額が伸びしてしまうことになります。

常駐でオートスケールしない self-hosted runner を使っている場合や、全体の CI の実行時間が十分に短い場合等はインスタンス稼働時間が2倍近くになってもそれほど気にならないかもしれませんが、CIの実行時間がそこそこ長い、かつインスタンス稼働時間に応じて課金額が変わってくる仕組みの場合はこれだと困るので、そういった用途で使える後者の方針をこのエントリでは紹介します。

## 試したリポジトリ

https://github.com/d-kimuson/hook-on-all-job-finished

コードの全文はリポジトリから確認できます。

## 任意のワークフローが完了したタイミングで確認用のワークフローを動かす

公式ドキュメントにサポートされているイベントの一覧が書かれています。

[Events that trigger workflows - GitHub Docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)

こちらを見てみると任意のワークフローが完了したときにワークフローを起動する、を実現できそうなイベントがいくつかあります。

- worflow_run
- check_run
- check_suite

ただ調べてみると check_run や check_suite はどうやら actions の check というより CodeBuild 等 GitHub Actions の外のチェックのステータスを取り込む用途らしく、実際試してみても GitHub Actions のワークフロー完了時にはワークフローが発火しませんでした。

ということで、workflow_run を使って以下の形で起動することにします。

```yaml:.github/workflows/on-all-job-finished.yml
on:
  workflow_run:
    workflows:
      - '*'
    types:
      - completed
```

これで任意のワークフローの実行が完了したタイミングでこのワークフローを呼び出すことができます。

## 完了チェックの処理を書く

任意のワークフローが実行完了したタイミングでワークフローを起動できるようになったので、ワークフローの完了状態を確認する処理を書いていきます。

方針としては

- [GitHub REST API](https://docs.github.com/ja/rest?apiVersion=2022-11-28) の [List check runs for a Git reference](https://docs.github.com/ja/free-pro-team@latest/rest/checks/runs?apiVersion=2022-11-28#list-check-runs-for-a-git-reference) を使ってワークフローが起動されたコミットハッシュに紐づく check の一覧を取得する
- check の一覧には今実装している完了チェックのワークフローも含まれるので除外する
- 残った check の一覧をみて成功で完了・失敗・キャンセルされた等の状態にまとめる

という形で実装していきます。

GitHub Actions から GitHub REST API を叩くには [github-script](https://github.com/actions/github-script) が便利なのでこちらで書いていきます。

### github-script のファイル分割と型チェック

github-script はワークフローの yaml ファイルの中に書きますが、分割して書いた JavaScript ファイルを読み込むことができます。

[GitHub - actions/github-script: Write workflows scripting the GitHub API in JavaScript](https://github.com/actions/github-script#run-a-separate-file)

yaml の中に JavaScript を書くのはなかなかつらいので `.github/workflows/script.cjs` にファイルを置いて実態はこの中に書いてあげる前提で以下のように Job を設定します。

```yaml:.github/workflows/on-all-job-finished.yml
jobs:
  check_if_all_job_finished:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - uses: actions/github-script@v7
        id: all-workflow-summary
        with:
          script: |
            return await require('./.github/workflows/script.cjs')({ github, context })
          result-encoding: string
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

これで `script.cjs` で github, context に依存してステータス判定の処理を書き、戻り値を result に書き出すことができます。

また、github-scipt から利用できる github オブジェクトと context オブジェクトは型定義が利用できるのでこちらもインストールしておきましょう。

```bash
$ pnpm add -D @actions/github @octokit/rest
```

これで JSDoc で型をつけてあげることで

```js:.github/workflows/script.cjs
// @ts-check

/**
 * @typedef {import("@octokit/rest").Octokit} OctokitClient
 * @link https://octokit.github.io/rest.js/v20#usage
 */

/** @typedef {import("@actions/github").context} WorkflowRunContext */

/** @type {(arg: { github: { rest: OctokitClient }, context: WorkflowRunContext }) => Promise<void>} */
module.exports = async ({ github, context }) => {
  // ここに処理を書く
}
```

このように補完・型チェックを聞かせながら書いていくことができます。

### 実際の処理を書く

早速ですが、チェック処理の全文は以下になります。

```js
// @ts-check

/**
 * @typedef {import("@octokit/rest").Octokit} OctokitClient
 * @link https://octokit.github.io/rest.js/v20#usage
 */

/** @typedef {import("@actions/github").context} WorkflowRunContext */

/** @typedef {'SUCCESS_ALL' | 'IN_PROGRESS' | 'FAILED_INPROGRESS' | 'FAILED_AND_COMPLETED' | 'CANCELED' | 'UNKNOWN'} CheckStatus */

const SELF_JOB_NAME = "check_if_all_job_finished"
/** @type {ReadonlyArray<string>} */
const IGNORE_WORKFLOW_NAMES = []
const PER_PAGE = 100

/** @type {(arg: { github: { rest: OctokitClient }, context: WorkflowRunContext }) => Promise<CheckStatus>} */
module.exports = async ({ github, context }) => {
  console.log(`Check For ${context.payload.workflow_run.path}`)

  const otherJobChecks = await fetchRuns(1).then(async (res) => {
    const totalCount = res.data.total_count
    const runsPage1 = res.data.check_runs

    // ページネーションされており1度に100件までしか取得できないので
    const allRuns = await Promise.all(
      Array.from({ length: Math.ceil(totalCount / PER_PAGE) - 1 })
        .map((_, i) => i + 2)
        .map((page) => fetchRuns(page).then((res) => res.data.check_runs))
    ).then((check_runs) =>
      runsPage1
        .concat(check_runs.flat())
        .filter(
          ({ name }) =>
            name !== SELF_JOB_NAME && !IGNORE_WORKFLOW_NAMES.includes(name)
        )
    )

    return allRuns
  })

  const failedJobChecks = otherJobChecks.filter(
    ({ conclusion }) => conclusion === "failure" || conclusion === "timed_out"
  )

  const notCompletedJobChecks = otherJobChecks.filter(
    ({ status }) => status !== "completed"
  )

  /** @type {CheckStatus} */
  const status = (() => {
    if (failedJobChecks.length > 1) {
      // FAILED
      if (notCompletedJobChecks.length === 0) return "FAILED_AND_COMPLETED"

      return "FAILED_INPROGRESS"
    } else if (notCompletedJobChecks.length === 0) {
      // SUCCESS
      if (
        otherJobChecks.every(
          ({ conclusion }) =>
            conclusion === "success" ||
            conclusion === "skipped" ||
            conclusion === "action_required"
        )
      ) {
        return "SUCCESS_ALL"
      }

      if (otherJobChecks.some(({ conclusion }) => conclusion === "cancelled"))
        return "CANCELED"

      console.log("otherJobChecks", otherJobChecks)
      return "UNKNOWN" // 完了はしているが想定していない conclusion が帰ってきている
    } else {
      // INPROGRESS

      console.log("notCompletedJobChecks", notCompletedJobChecks)
      return "IN_PROGRESS"
    }
  })()

  console.log("status", status)
  return status
}
```

詳細な実装はコードを読んでいただくのが早いと思うので要点だけ説明します。

check の配列から以下のステータスを計算します。

- `SUCESS_ALL`: すべてのワークフローが正常終了
- `IN_PROGRESS`: 未完了のワークフローがある
- `FAILED_INPROGRESS`: 未完了のワークフローがありすでに失敗しているワークフローがある
- `FAILED_AND_COMPLETED`: すべてのワークフローが完了し、失敗したワークフローがあった
- `CANCELED`: いずれかのワークフローがキャンセルされた
- `UNKNOWN`: 想定外の状態

判定ロジックとしては、check の状態として

- status: 成功/失敗に関わらず完了してるかどうかが拾える
- conclusion: 未完了時は null で、どういう結果で完了したかが拾える

の 2 つがあるので、これらを元に status を計算しています。詳細な実装はコードをご参照ください。

## 特定のステータスのときに任意の処理を実行する

あとはもうほぼできたようなものですが、前ステップで計算したステータスの値を元に書きたい処理を追加していきます。

ステータスは `steps.all-workflow-summary.outputs.result` で参照できるので、この値を条件に、任意の処理を書いていくことができます。

今回は例としてログを残す処理を書いてみます。

```yaml
jobs:
  check_if_all_job_finished:
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      # ...

      - name: log_success
        if: steps.all-workflow-summary.outputs.result == 'SUCCESS_ALL'
        run: |
          echo "すべてのチェックが成功しました:tada:"
```

これですべてのワークフローが正常終了したときに `log_success` のステップを実行できるようになりました。

今回はサンプルとして echo する処理を書きましたが

- CI 完了通知をステータスと共に Slack へ流す
- CODEOWNERS でレビュワーをアサインしているなら CI 完了後にレビューを依頼したい Draft を外す処理を書く

等をすることで CI 完了の確認から解放させることができます！

## 注意点: check runs の上限は1000件

GitHub Actions の check runs は上限が1000件であり、超えると古い check_runs は削除されていくという仕様があります。

https://docs.github.com/ja/rest/checks/runs?apiVersion=2022-11-28

> In a check suite, GitHub limits the number of check runs with the same name to 1000. Once these check runs exceed 1000, GitHub will start to automatically delete older check runs.

現実的な利用範囲では問題にならないと思いますが、1000件を超えてくるとこのワークフローでは対応できないので注意してください。

## チェックのコスト

このワークフローのコストについて補足しておきます。

GitHub Hosted の runner を使って、手元の環境では平均 15s くらい(ページ数1のとき)で実行が完了しています。

仮にワークフローの数が 10 個あったとして合計で 2 分 30 秒程増える程度なので、wait する方法とは違ってCIの実行時間が長かったとしてもあまり気にせず利用できると思います。

## おわりに

GitHub Actions ですべてのワークフローが完了したときに任意の処理を行う方法について紹介しました。
GitHub Script を使って CI が完了するたびに全件の完了チェックすることで実行時間の増加をあまり気にせずに任意の処理を行わせることができます。
チームのワークフローに合わせて Slack 通知や Auto-Merge 等を組み込んでみるのがいかがでしょうか！

明日の記事は [@shotaogasawara](https://qiita.com/shotaogasawara) の予定です！
