---
title: "Vuex 4 に型付けするための vuex-typing を作った"
emoji: "🍣"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["TypeScript", "Vuex", "Vue.js"]
published: true
---

追記

最近では型安全にグローバルステートを扱える Pinia が登場しているので新規で使う場合は先にそちらを検討するのが良いと思います。一方、Vuex からのマイグレーションは結構大変っぽいので、既存の Vuex リソースで型付けをしたいと考えているならこの記事で紹介している vuex-typing やその他の選択肢も選択肢になりそうです。

---

Vuex を仕事で使う機会がありそうなので勉強していたんですが、型付けのサポートが不十分で不満があったので型付けするためのヘルパーライブラリを作りました

- リポジトリ: https://github.com/d-kimuson/vuex-typing
- npm: https://www.npmjs.com/package/vuex-typing

## Vuex の型定義が不十分

アプリケーションがいずれ肥大化することを考えれば、はじめからモジュールに分けて管理するのが良いと思うのですが、Vuex4 ではほとんどモジュールの型付けのサポートがありません

```ts:公式の型付け
export const store = createStore({
  // ...
  modules: {
    counter: {
      namespaced: true,
      state: () => {
        return {
          count: 0
        }
      },
      mutations: {
        increment: (state /* any になる */) => {
          state.count = state.count + 1
        }
      },
      actions: {
        INCREMENT: (context /* any になる */) => {
          context.commit('increment')
        }
      }
    }
  },
})
```

この辺りを解消するには、独自でモジュールの型を定義する必要があり、例えば以下のようになります

```ts:自前で型付け
type CounterState = {
  count: number
}

type CounterMutation = {
  increment: (state: CounterState) => void
}

type CounterContext = {
  commit: <Key extends keyof CounterMutation>(  // 試してないので間違ってるかもだけど、概ねこういうの
    key: Key,
    payload?: CounterMutation<typeof key> extends (state: any, payload: infer I) => any
      ? I
      : never
  ) => ReturnType<CounterMutation<typeof key>>,
  /* getters, dispatch も必要 */
}

type CounterAction = {
  INCREMENT: (context: CounterContext) => Promise<void>
}

export const counterModule = {
  state: (): CounterState => {
    return {
      count: 0
    }
  },
  mutations: {
    increment: (state: CounterState) => {
      state.count = state.count + 1
    }
  },
  actions: {
    INCREMENT: ({ commit }: CounterContext) => {
      commit('increment')
    }
  }
}
```

これなら一応ちゃんと型付けした状態でモジュールを書くことはできますが、型宣言と実装を分けて書かないといけないので冗長になりますし、差分が出たときにも型定義と実装を両方修正する必要があり面倒です

またモジュールに限らず、定義した actions や getters を呼び出すときにも型付けが提供されません

```ts
const store = useStore()
store.dispatch('INCREMENT') /* 引数にも戻り値にも型付けされない */
```

一番ここに型付けが欲しいと思うので、この辺りの型付けもなんとかしたいと思って vuex-typing を作りました

## 導入

npm から [vuex@4](https://www.npmjs.com/package/vuex) と [vuex-typing](https://www.npmjs.com/package/vuex-typing) を追加します

```bash
yarn add vue@next vuex@next vuex-typing
```

## モジュールの型付け

vuex-typing では、型付け用の関数を通すことで実装から型情報を拾い型付けを行います
上の例は vuex-typing では以下のように書くことができます

```ts:store/modules/counter.ts
import { defineModule } from 'vuex-typing'

export const counterModuleName = "counter"

const counterModule = defineModule({
  state: () => ({
    count: 0
  }),
  mutations: {
    increment: (state /* 明示せずとも state の型が付く */) => {
      state.count = state.count + 1
    }
  }
}, {
  // actions
  INCREMENT: ({ commit } /* 明示せずとも context の型が付く */) => {
    commit('increment_typo')  // 型エラー (登録していないミューテーション)
    commit("increment", 20)   // 型エラー (payload の型が異なる)
    commit('increment')       // OK
  }
})

type CounterModule = typeof counterModule
```

ちゃんと型付けできていることがわかります

![](https://storage.googleapis.com/zenn-user-upload/be219d56a8fb58f1b6177a1e.png)

actions だけ mutations の型付けを拾うために第2引数で渡します。
defineModule では第1引数に actions を結合して、`namespaced: true` を指定してモジュールオプションを作ります。

```js:トランスパイルしたdefineModule
export function defineModule(module, actions) {
  return {
    ...module,
    namespaced: true,
    actions: actions,
  };
}
```

ですので、戻り値をそのまま Vuex Store の宣言に渡すことでモジュールを登録できます。

※ 型付けが複雑になるので `namespaced: true` を強制しています

## store の型付け

Vuex4 の useStore では store に型付けがされますが、冒頭で書いたように `getters` や `dispatch` への型付けができませんので、vuex-typing の `TypedStore` で型定義を生成し、公式の

[TypeScript Support \| Vuex](https://next.vuex.vuejs.org/guide/typescript-support.html#typing-usestore-composition-function)

にしたがって、型定義を上書きした useStore を定義します

```ts:store/index.ts
import { createStore } from "vuex"
import { TypedStore } from "vuex-typing"

import { counterModuleName, counterModule } from "./modules/counter"

export type RootState = {}
export type ModuleType = {
  [counterModuleName]: typeof counterModule
}

export type RootStore = TypedStore<RootState, ModuleType>

export const store = createStore<RootState>({
  state: {
    rootVal: "ok",
  },
  modules: {
    [counterModuleName]: counterModule,
  },
})
```

```ts:store/util.ts
import { InjectionKey } from "vue"
import { useStore as baseUseStore } from "vuex"
import type { RootStore } from "."

export const key: InjectionKey<RootStore> = Symbol()

export function useStore(): RootStore {
  return baseUseStore(key)
}
```

これで、独自定義した `useStore` を使うことで型付けされた状態で `dispatch` やモジュールのステートを使うことができます

```ts:sample-component.ts
import { useStore } from '~/store/util'

const store = useStore()

store.state.counter.count  // :number
const result /* :Promise<void> */ = store.dispatch('counter/INCREMENT')  // OK
store.dispatch('counter/INCREMENT_TYPO')  // 型エラー
store.dispatch('counter/INCREMENT', 20)   // payload の型エラー
```

同様に `TypedStore` で定義した型を使って Option API にも型付けができます

参考: [TypeScript Support \| Vuex#typing-store-property-in-vue-component](https://next.vuex.vuejs.org/guide/typescript-support.html#typing-store-property-in-vue-component)

```ts:@types/vuex.d.ts
import type { RootStore } from "../src/store/index"

declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $store: RootStore
  }
}
```

これで `this.$store` にも型付けされました

## mapHelpers を使う

mapHelpers (mapState, mapGetters, mapActions) にも型付けすることができます。

`useStore` 同様に vuex-typing の型で型定義を上書きします。

```ts:store/util.ts
import {
  mapGetters as baseMapGetters,
  mapState as baseMapState,
  mapActions as baseMapActions,
} from "vuex"
import { MapState, MapGetters, MapActions } from "vuex-typing"
import type { RootStore, ModuleType } from "."

export const mapState = baseMapState as unknown as MapState<
  RootStore["state"],
  ModuleType
>
export const mapGetters = baseMapGetters as unknown as MapGetters<ModuleType>
export const mapActions = baseMapActions as unknown as MapActions<ModuleType>
```

コンポーネントからは型定義を上書きした mapHelpers 関数を利用します

```ts:sample-component.ts
import { defineComponent } from "vue"
import { mapState, mapGetters, mapActions } from "../store/util"

defineComponent({
  computed: {
    ...mapState("counter", {
      count: (state /* 型付けされてる */) => state.count,
    }),
    // モジュール名、プロパティ('cnt', 'PLUS_N' 等)が間違っていたら型エラーに
    ...mapGetters("counter", ["cnt"]),
    ...mapGetters(["counter/cnt"]),
  },
  methods: {
    ...mapActions(["counter/INCREMENT"]),
    ...mapActions("counter", ["PLUS_N"]),
    test() {
      // mapState
      this.count // :number

      // mapGetters
      this["counter/cnt"] // :number
      this.cnt // :number

      // mapActions
      this["counter/INCREMENT"]()
      this.PLUS_N(20)
    },
  },
})
```

## 自身の getters と actions を参照する

Vuex のモジュールでは、モジュール内で宣言された他の getters, actions を利用することができますが、循環参照になってしまうのでこの型付けはできません。代わりに明示的に型付けすることができます

```ts
import { defineModule, LocalGetters, LocalDispatch } from "vuex-typing"

export const counterModule = defineModule({
  getters: {
    cnt: (state) => state.count,
    cnt2: (_state, _getters): number /* 循環参照になるので明示する必要がある */ => {
      const getters = _getters as LocalGetters<CounterModule["getters"]>  // 上書き
      return getters.cnt
    },
  },
  {
    INCREMENT: ({ commit }): void => {
      commit("increment")
    },
    PLUS_N_LOOP: ({ dispatch: _dispatch }, n: number) => {
      const dispatch: LocalDispatch<CounterModule["actions"]> = _dispatch  // 上書き

      for (const _i of new Array(n)) {
        dispatch("INCREMENT")
      }
    },
  }
})

type CounterModule = typeof counterModule
```

以上が主な使い方です。

全体を通したサンプルは [公式リポジトリのexample](https://github.com/d-kimuson/vuex-typing/tree/master/example) にあります。`yarn create @vitejs/app example --template vue-ts` で生成されたボイラープレートに vuex-typing の例を乗せているので、クローンしてそのまま試すことができます。

## できないこと

Vuex はかなり使い方が柔軟で一言にグローバルステートを管理すると言っても複数のステート管理・呼び出しの方法があり、すべて型付けするのは無理があるので機能を削っています

- getter からグローバルのステートやゲッターを使う
  - `someGetter(state, getters, rootState, rootGetters)` で getters, rootState, rootGetters にアクセスできますが、この型付けはできません(rootState だけは getters と同様に明示して型定義を上書きできます)
  - 参考: [モジュール \| Vuex#名前空間付きモジュールでのグローバルアセットへのアクセス](https://next.vuex.vuejs.org/ja/guide/modules.html#%E5%90%8D%E5%89%8D%E7%A9%BA%E9%96%93%E4%BB%98%E3%81%8D%E3%83%A2%E3%82%B8%E3%83%A5%E3%83%BC%E3%83%AB%E3%81%A7%E3%81%AE%E3%82%B0%E3%83%AD%E3%83%BC%E3%83%90%E3%83%AB%E3%82%A2%E3%82%BB%E3%83%83%E3%83%88%E3%81%B8%E3%81%AE%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B9)
- `nampespaced: true` でないモジュール
- ネストされたモジュール
  - モジュールの中にモジュールを宣言することもできるみたいですが、型付けに無理があるので対応していません
  - 参考: [モジュール \| Vuex#名前空間](https://next.vuex.vuejs.org/ja/guide/modules.html#%E5%90%8D%E5%89%8D%E7%A9%BA%E9%96%93)
- グローバルのゲッター、ミューテションやアクションへの型付け
  - createStore がステートしか型情報を拾っていないので拾いたければ createStore の型定義を上書きする等しないといけないので対応していません
  - ステートは一応拾えるので型付けしています

ですので、`vuex-typing` を使う場合はステートはすべてモジュールで管理する (グローバルにステートやアクション等を生やさない) 形にするのが良いと思います。(一貫性があるほうが読むときも読みやすいし)

## 型付けの他の選択肢

ライブラリを作る前に色々型付け周りの選択肢を調べたのでまとめておきます。

### Vuex5

Vuex5 でかなり API は変わりそうですが、TypeScript のフルサポートが入るようなので将来的に Vuex5 がリリースされてから新規で Vuex を追加する場合はおとなしく Vuex5 の流儀で型付けするのが良さそうです。

ただ API が結構変わるようなので既存の Vuex からのマイグレーションは大変そう、、

参考: [Vuex 5でどのように変わるのか？](https://zenn.dev/azukiazusa/articles/38e9f804474668)

## ktsn/vuex-type-helper

[ktsn/vuex-type-helper](https://github.com/ktsn/vuex-type-helper) という型付けのヘルパーライブラリがあり、冒頭で書いた Context 等の型定義を準備してくれています。

型定義と実装を分けて書かないといけない点は変わりませんが、Context 等の長々として型はヘルパーとして準備してくれるので自前で準備するよりも良さそうです。

この記事で使った例は `vuex-type-helper` だと以下のように書けます

```ts:サンプル
import * as Vuex from 'vuex'
import { DefineMutations, DefineActions, Dispatcher, Committer } from 'vuex-type-helper'

// 型定義
export interface CounterState {
  count: number
}

export interface CounterMutation {
  increment: void
}

export interface CounterActions {
  INCREMENT: void
}

// 実装
const state: CounterState = {
  count: 0
}

const mutations: DefineMutations<CounterMutations, CounterState> = {
  increment (state) {
    state.count = statel.count + 1
  }
}

const actions: DefineActions<CounterActions, CounterState, CounterMutations, CounterGetters> = {
  INCREMENT ({ commit }) {
    commit('increment')
  }
}
```

### paroi-tech/direct-vuex

[paroi-tech/direct-vuex](https://github.com/paroi-tech/direct-vuex) というライブラリがあり、こちらでも `vuex-typing` と同様のアプローチで型付けをしています

かなり感触は良かったんですが、Vuex の標準から外れたアクションやゲッターの呼び出しをするのと、ストア登録の仕方も少し異なるので、その辺りを許容できれば良い選択肢になりそうです

```ts:サンプル
store.dispatch("mod1/myAction", myPayload)  // Vuex 標準
store.dispatch.mod1.myAction(myPayload)     // direct-vuex での書き方
```

すでにありそうだな〜と思って調べてこのライブラリが見つかり、型付けの方針はとても良かったのですがいずれちゃんとした TypeScript サポートが入ることを考えれば標準から外れたくないと思って作ったのが `vuex-typing` でした (Vuex5 で API が変わるといっても流石に標準に沿っていたほうがマイグレーションコストは低いと思うので)

## 終わりに

以上、[vuex-typing](https://github.com/d-kimuson/vuex-typing) の紹介でした
新しく Vuex を使う機会があったらぜひ使ってみてくださいー

## 参考

- [Vuex とは何か？ \| Vuex](https://next.vuex.vuejs.org/ja/index.html)
- [Vuex 5でどのように変わるのか？](https://zenn.dev/azukiazusa/articles/38e9f804474668)
- [GitHub - ktsn/vuex-type-helper: Type level helper to ensure type safety in Vuex](https://github.com/ktsn/vuex-type-helper)
- [GitHub - paroi-tech/direct-vuex: Use and implement your Vuex store with TypeScript types. Compatible with the Vue 3 composition API.](https://github.com/paroi-tech/direct-vuex)
- [Vuex4 を Composition API + TypeScript で入門する](https://zenn.dev/ryo_kawamata/articles/intoroduce-vuex4-with-composition-api)
