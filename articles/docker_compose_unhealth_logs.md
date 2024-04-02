---
title: "docker compose でunhealthyまたは異常終了したサービスのログのみ出力するスクリプト"
emoji: "😱"
type: tech
topics: []
published: false
---

## なにがやりたいか

docker compose には `--wait` という up したサービスが healthy になるのを待つオプションがあります。

```bash
$ docker compose up -d --wait
```

これを利用して CI で docker compose によってすべてのサービスが正常に起動することを確認しようとしていたのですが、異常終了したときに up 時のログは出力されないため原因調査が非常に面倒です。

かといってログをすべて出すと非常に冗長でわかりづらいので、docker ps のステータスから unhealthy または 0 以外の Code で Exit したコンテナのログのみ出してあげるスクリプトを作ってあげます。

## スクリプト

```bash
docker ps -a --format '{{json .}}' | jq -r 'select((.Status | contains("unhealthy")) or (.Status | contains("Exit") and (contains("Exited (0)") | not) )) | .Names' |
while read -r container; do
  docker logs $container
done
```

docker ps には machine readable な出力形式にできる `--json` オプションがあります。このオプションを使ってステータスを jq でごにょごにょして

- unhealthy
- 0 以外で Exit

したコンテナを絞り込み docker logs に渡しています。

これを CI に仕込んでおくことで失敗したログのみ抽出して出力することができるようになりました。

## まとめ

失敗したコンテナのログを出力するスクリプトの紹介でした。

ローカルでもスニペットに登録する等しておけば docker ps して失敗したコンテナ調べずにログを出せるので便利です。
