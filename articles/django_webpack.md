---
title: "Djangoとwebpackを連携して､ モダンなフロントエンド環境を構築する"
slug: "b2a96d7c8729659379d3"
emoji: "📚"
type: "tech"
topics: ["python", "django", "webpack"]
published: true
---

## まえがき

今回は Zenn に興味があったので､ アカウントとリポジトリを作ってみて､ せっかくだからなにか書いてみようかなーと思って書いてました｡

## TL;DR

[Django](https://github.com/django/django) はとても強力なフレームワークですが､ フロントエンドファイル(`*.html`, `*.js`, `*.css`)のホットリロードやTypeScript､ Sass等モダンなフロントエンド環境をサポートしていません｡

Djangoにおけるモノリス開発でもSCSSをかけて､ ホットリロードできて､ ベンダープレフィクス付与してくれてみたいなDXの高いフロントの開発環境をつくれないかなーと思って調査したので､ 紹介します｡

完成系は [d-kimuson/django-modern-frontend-sample](https://github.com/d-kimuson/django-modern-frontend-sample) に公開してあります｡

## How ?

具体的な方法ですが､ DjangoサーバーとWebpackを連携して､ フロントエンド環境はすべてwebpackに任せることで実現します｡

webpack では､ [Caching \| webpack](https://webpack.js.org/guides/caching/) で説明されているように､ キャッシュを最適化するため､ ビルド時にファイル名にハッシュ値を付与することが推奨されています｡

ビルドのたびにハッシュ値が変わり得るので､ Django から素直に静的ファイルを読むことはできません｡ 例えば､ `main.js` をエントリにしたソースは､ `main.hogehoge.js` や `main.hugahuga.js` として出力され､ これらのハッシュ値(`hogehoge`, `hugahuga`の部分)は毎度変わるからです｡

対応としては2種類考えられます

1. ビルド先のファイル名にハッシュ値を含めない (`main.js` => `main.bundle.js` のような固定の名前に出力する)
2. バンドル情報を webpack から Django に渡してあげて､ Django はその情報に基づいて読む静的ファイルのリンクを変更する

1だとキャッシュ最適化ガー､ 2は面倒いしなあって感じですけど､ この辺の連携を上手くとってくれるライブラリが公開されているのでこちらを利用します

- [owais/webpack-bundle-tracker](https://github.com/owais/webpack-bundle-tracker) : webpack のバンドル情報を `json` 形式で出力してくれます(`main.js` エントリが､ `main.hogehoge.js` としてビルドされた､ というような情報が書き出されます)｡
- [owais/django-webpack-loader](https://github.com/owais/django-webpack-loader) : `webpack-bundle-tracker` が吐き出した `json` に基づいて静的ファイルを読み込んでくれる

これで一通り実現できそうです｡

実際に作っていきます

## 環境

Django及びwebpack関連のバージョンは以下のとおりです.

``` bash
$ pip list
Package               Version
--------------------- -------
Django                3.1.2
django-webpack-loader 0.7.0

$ yarn list | grep webpack
├─ webpack-bundle-tracker@0.4.3
├─ webpack-cli@3.3.12
├─ webpack-dev-server@3.11.0
├─ webpack-merge@5.2.0
├─ webpack@5.1.0
```

## まずは､ Djangoで簡単なサイトを作る

最初に､ 適当にTOPページを表示するだけのシンプルなサイトを作っていきます

ディレクトリ構造は､

``` bash
$ \tree . -L 2
.
├── backend  # Djangoアプリを置く
│   ├── Pipfile
│   ├── Pipfile.lock
│   ├── config
│   ├── db.sqlite3
│   ├── manage.py
│   └── sample
└── frontend  # Djangoテンプレートとフロント周りの色々
    ├── node_modules
    ├── package.json
    ├── static
    ├── templates
    └── # ...etc
```

こんな感じで､ `backend` に Django をつめて､ `frontend` に Django のテンプレートとスタイルシートやらJavaScriptやらを置いていきます

本題じゃないので､ サクサクいきます

``` bash
$ cd backend
$ pipenv --python=3.8 && source .venv/bin/activate
$ pipenv install django
$ django-admin startproject config .
$ python manage.py migrate
$ python manage.py startapp sample
```

`sample` アプリが作れたので､ 全体の設定を書いていきます.

``` python:backend/config/settings.py
# ...
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'sample.apps.SampleConfig',  # アプリの追加
]

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR.parent / 'frontend' / 'templates'],  # テンプレート置き場
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]
# ...
```

``` python:backend/config/urls.py
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('sample.urls'))  # ルーティングは sample に任せる
]
```

ここからアプリ側です｡

``` python:backend/sample/urls.py
from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index')  # とりあえずTOPページのみ
]
```

``` python:backend/sample/views.py
from django.shortcuts import render
from django.http import HttpRequest, HttpResponse


def index(request: HttpRequest) -> HttpResponse:
    return render(request, 'index.html', {})
```

あとは､ テンプレートを `frontend/templates/*.html` に書いていきます｡

良くある感じで､ `base.html` と `index.html` を準備してあげます｡

``` html:frontend/templates/base.html
<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  {% block external_header %}
  {% endblock %}
  <title>{% block title %}{% endblock %}</title>
</head>

<body>
  {% block content %}{% endblock %}
  {% block external_footer %}{% endblock %}
</body>

</html>
```

``` html:frontend/templates/index.html
{% extends 'base.html' %}
{% block title %}Index{% endblock %}

{% block content %}
<section>
  <h1 class="target">This is Index Page!</h1>
  <!-- `.target` でCSSの読み込み確認 -->
</section>
{% endblock %}
```

これで一通り書き終わりました｡

``` bash
$ python manage.py runserver
```

して､ http://localhost:8000 にアクセスすれば `Index Page` と表示されます｡

## webpack の設定を書く

Webpackの構成については､ モノリスである以上複数のエントリーポイントが想定されるので､

``` bash
$ tree frontend -I "node_modules"
.
├── dist         # ビルド先
│   └── ...
├── package.json
├── static       # 静的ファイル
│   ├── entries  # エントリーポイント
│   │   └── base.js
│   ├── scripts  # JS & TS
│   └── styles   # CSS & SCSS
│       └── sample.css
├── templates    # Django テンプレート
│   ├── base.html
│   └── index.html
├── webpack.config.js
└── yarn.lock
```

以上のようなディレクトリ構成で `backend/entries` にエントリーポイントになるスクリプトを置いていくことにします｡

必要なパッケージを取得しておきます｡

``` bash
$ yarn add -D webpack webpack-cli@3 webpack-dev-server webpack-merge css-loader style-loader
```

※ `webpack-cli` については､ 最新の4系で詰まって下げるごとが最近多いので3系を使ってます

まずは疎通だけしちゃいたいので､ CSSとJSを webpack 介してビルドするだけのシンプルな構成で `webpack.config.js` を書きます

``` javascript:frontend/webpack.config.js
const path = require('path');
const { merge } = require('webpack-merge');

const entries = {}
for (const fileName of require('fs').readdirSync(path.resolve(__dirname, 'static', 'entries'))) {
  entries[fileName.split('.')[0]] = `./static/entries/${fileName}`
}

const baseConfig = {
  entry: entries,  // `entries` 以下を登録
  output: {
    filename: 'js/[name].[hash].bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    splitChunks: {
      cacheGroups: {
        commons: {
          test: /[\\/]node_modules[\\/]/,
          chunks: 'initial',  // 後述しますが､ chunks: 'all' されていません
          name: 'vendor',
        },
      },
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
};

const devConfig = merge(baseConfig, {
  mode: 'development',
  output: {
    // Django が読みに来る(dev)
    publicPath: 'http://localhost:3000/static/',
  },
  devServer: {
    port: 3000,
    hot: true,
    watchOptions: {
      ignored: /node_modules/
    },
  },
});

const productConfig = merge(baseConfig, {
  mode: 'production',
  output: {
    // Django が読みに来る(production)
    publicPath: '/static/'
  }
})

module.exports = (env, options) => {
  return options.mode === 'production' ? productConfig : devConfig
}
```

とりあえず､ 全体(`base.html`)に読ませてみる用として

- `base.js` (エントリ)
- `sample.css`

を準備しておきます｡

``` javascript:frontend/static/entries/base.js
console.log('hello from base.js')

import "../styles/sample.css"
```

``` css:frontend/static/styles/sample.css
.target {
  color: red;
}
```

とりあえず､ ログと色で読み込まれているかだけ確認できるようにしました｡

あとは､ 開発サーバーの起動とビルド用に､ スクリプトを用意してあげて､

``` json:frontend/package.json
{
  // ...
  "scripts": {
    "build": "webpack --mode=production",
    "dev": "webpack-dev-server --mode=development"
  }
}
```

完成です｡

`yarn build` で `frontend/dist` にビルドファイルが生成され､

`yarn dev` で開発サーバーが起動し､ `http://localhost:3000/static/` からバンドルされた静的ファイルが配信されるようになりました｡

## webpack-bundle-tracker でバンドル情報を書き出す

さて､ やっと本題に入れます｡

冒頭でも書きましたように `webpack-bundle-tracker` を使って､ バンドル情報を `frontend/webpack-stats.json` に書き出します｡

``` bash
$ yarn add -D webpack-bundle-tracker@0
```

※ 0系と1系があるようですが､ `djagno-webpack-loader` が読む都合上0系を使います

``` js:frontend/webpack.config.js
const BundleTracker = require('webpack-bundle-tracker');

const baseConfig = {
  // ...
  plugins: [
    // ⇓ 追加 ⇓
    new BundleTracker({
      path: __dirname,
      filename: 'webpack-stats.json',
    }),
  ]
}

const devConfig = merge(baseConfig, {
  // ...
  devServer: {
    port: 3000,
    hot: true,
    // ⇓ 追加 ⇓
    headers: {
      "Access-Control-Allow-Origin": "*"
    },
    watchOptions: {
      ignored: /node_modules/
    },
  },
});
```

**開発サーバーを起動** または **ビルド** すると, `frontend/webpack-stats.json` が生成/更新されるのが分かります｡

## django-webpack-loader でバンドルした静的ファイルを読み込む

`webpack-stats.json` に従って､ Django側からバンドルファイルを読んでいきます

まずは､ `django-webpack-loader` をインストールします

``` bash
$ pipenv install django-webpack-loader
```

`django-webpack-loader` を `INSTALLED_APPS` に追加しつつ､ 静的ファイル配信関連 & パッケージ固有の設定を書きます｡

``` python:backend/config/settings.py
# ...
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'webpack_loader',  # APPSに追加
    'sample.apps.SampleConfig',
]
# ...
# 静的ファイル周りの設定
STATIC_URL = '/static/'
STATICFILES_DIRS = (
    # webpack がここにバンドルしたファイルを吐き出すように設定済み
    BASE_DIR.parent / 'frontend' / 'dist',
)
STATIC_ROOT = BASE_DIR / 'static'

# Webpack Loader
WEBPACK_LOADER = {
    'DEFAULT': {
        'BUNDLE_DIR_NAME': '',  # '/' ではダメ
        'STATS_FILE': BASE_DIR.parent / 'frontend' / 'webpack-stats.json',
    }
}
```

設定はこれで以上になります｡

肝心のバンドルファイルの読み込み方ですが､ `django-webpack-loader` が提供するテンプレートタグを使います

Djangoがデフォルトで提供する `{% load static %}`､ `{% static sample.css %}` とかと同じイメージです｡

``` html:frontend/templates/base.html
<!-- ⇓ webpack_loader のタグを有効化 ⇓ -->
{% load render_bundle from webpack_loader %}

<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  {% block external_header %}
  {% endblock %}
  <title>{% block title %}{% endblock %}</title>
</head>

<body>
  {% block content %}{% endblock %}
  <!-- ⇓ ビルドされたスクリプトを読み込む ⇓ -->
  {% render_bundle 'vendor' 'js' %}
  {% render_bundle 'base' 'js' %}
  {% block external_footer %}{% endblock %}
</body>

</html>
```

これで､ バンドルされたファイルを読み込むことができました！

`webpack-dev-server` を立てた状態で､ 開発サーバーを立てて http://localhost:8000 を見に行けば､ バンドルされたJSが読み込まれて､ スタイルの適用とスクリプトの実行がされていることが確認できます｡

ホットリロードにも対応しているので､ CSSファイルまたはJSのファイルを書き換えると自動で適用されるのがわかります！わーい！

### 補足

読み込みの補足ですが､ `{% render_bundle 'base' 'js' %}` は､ webpack の `base` エントリによってバンドルされた `js` ファイルを読み込みます｡

開発サーバーにおいては､ `webpack.config.js` で `output: { publicPath: 'http://localhost:3000/static/' }` が指定されているので､ `http://localhost:3000/static/js/base.<hash>.bundle.js` に置き換わることになります｡

## インラインスタイルではなく､ CSSファイルを使いたい

[MiniCssExtractPlugin](https://webpack.js.org/plugins/mini-css-extract-plugin/) を使って書き出したCSSファイルを読み込むこともできます｡

``` bash
$ yarn add -D mini-css-extract-plugin
```

``` javascript:frontend/webpack.config.js
const baseConfig = {
  // ...
  plugins: [
    new BundleTracker({
      path: __dirname,
      filename: 'webpack-stats.json',
    }),
    new MiniCssExtractPlugin({
      filename: 'css/[name].[hash].bundle.css'
    }),
  ],
  // ...
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
          },
          {
            loader: 'css-loader'
          },
        ],
      },
    ],
  },
};
```

普通に `webpack` の設定に刺して､ `$ yarn build` してみると､

``` bash
$ tree dist
dist
├── css
│   └── base.<hash>.css
└── js
    ├── base.<hash>.bundle.js
    └── index.<hash>.bundle.js
```

問題なく生成されていることがわかります

これをDjangoから読むには､ JavaScript と同様に `{% render_bundle 'base' 'css' %}` してあげれば良いだけです

``` html:frontend/templates/base.html
{% load render_bundle from webpack_loader %}

<!DOCTYPE html>
<html lang="ja">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  {% render_bundle 'base' 'css' %}
  {% block external_header %}
  {% endblock %}
  <title>{% block title %}{% endblock %}</title>
</head>

<body>
  {% block content %}{% endblock %}
  {% render_bundle 'vendor' 'js' %}
  {% render_bundle 'base' 'js' %}
  {% block external_footer %}{% endblock %}
</body>

</html>
```

今度はインラインスタイルではなく､ バンドルされたCSSファイルからスタイルが読まれていることが確認できます

## テンプレートの更新でもホットリロードしたい

CSSとか､ JavaScript ファイルではホットリロードが回るんですが､ テンプレートほうはダメそうで｡

この辺は対応してるかなーと思って､ `django-webpack-loader` のリポジトリやら色々読んでみたんですが､ なさそうでした.

力技になっちゃいますけど､ `webpack-dev-server` の `proxy` を使って一応実現できます

``` js:frontend/webpack.config.js
const devConfig = merge(baseConfig, {
  mode: 'development',
  output: {
    publicPath: 'http://localhost:3000/static/',
  },
  devServer: {
    port: 3000,
    hot: true,
    headers: {
      "Access-Control-Allow-Origin": "*"  // For hot reload
    },
    watchOptions: {
      ignored: /node_modules/
    },

    // ⇓ 追加 ⇓
    contentBase: [
      path.resolve(__dirname, 'templates'),
      path.resolve(__dirname, 'static'),
    ],
    watchContentBase: true,
    proxy: {
      '/': 'http://localhost:8000',
    },
  },
});
```

`http://localhost:3000/*` を見に行くと､ `webpack-dev-server` が自分で配信するファイル(JS, CSS)については直接返しますが､ それ以外についてはそのまま Django の開発サーバー(8000)に繋ぎます

これで一応HTMLファイルでもホットリロードされるようになりました｡

## 本番環境は大丈夫なの ?

開発環境では､ localhost:3000 を覗いてるけど本番環境はどうするのって話ですけど､ この辺もうまくやってくれます.

まず､ ビルド先の `frontend/dist` を `STATICFILES_DIR` に指定しているので､

``` bash
$ python manage.py collectstatic
```

すれば､ 他の静的ファイル同様に `STATIC_ROOT` に集めてもらえます

``` bash
$ cd frontend && yarn build
# frontend/dist にビルドされる
$ cd ../backend
$ python manage.py collectstatic

135 static files copied to '/path/to/dj-modern-frontend/backend/static'.
$ tree static
static
├── <その他>
├── css
│   └── base.<hash>.bundle.css
└── js
    ├── base.<hash>.bundle.js
    └── index.<hash>.bundle.js
```

読み込みについても､

`{% render_bundle '<entry>' '<type>' %}` では､ `webpack-stats.json` の `publicPath` に繫いでいるだけなので､ `webpack` の設定に応じて､

- `webpack --mode=development` => `http://localhost:3000/static/*`
- `webpack --mode=production` => `/static/*`

と言った具合に `publicPath` が出力されて､ 読み込みもうまく行くようになります

## TypeScript､ SCSS対応とLinter

フロント周りを `webpack` が持つようになったので､ あとは好きにカスタマイズできます｡

せっかくなんで

- TypeScript
- SASS / PostCSS
- ESLint / Stylelint / prettier

辺りのそれっぽいのを適当にぶっこんでみます

``` bash
$ yarn add -D clean-webpack-plugin terser-webpack-plugin
$ yarn add -D stylelint stylelint-config-recommended stylelint-config-standard-scss stylelint-scss stylelint-webpack-plugin stylelint-prettier stylelint-config-prettier prettier
$ yarn add -D sass fibers sass-loader
$ yarn add -D postcss postcss-loader autoprefixer postcss-flexbugs-fixes cssnano
$ yarn add -D typescript ts-loader
$ yarn add -D eslint eslint-loader @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-prettier eslint-config-prettier
```

パッケージの数えぐいな

`webpack.config.js` を更新します

``` js:webpack.config.js
const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')
const StyleLintPlugin = require('stylelint-webpack-plugin')
const { merge } = require('webpack-merge');
const BundleTracker = require('webpack-bundle-tracker');

const entries = {}
for (const fileName of require('fs').readdirSync(path.resolve(__dirname, 'static', 'entries'))) {
  entries[fileName.split('.')[0]] = `./static/entries/${fileName}`
}

const baseConfig = {
  entry: entries,
  output: {
    filename: 'js/[name].[hash].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/static/'
  },
  plugins: [
    new BundleTracker({
      path: __dirname,
      filename: 'webpack-stats.json',
    }),
    new MiniCssExtractPlugin({
      filename: 'css/[name].[hash].bundle.css'
    }),
    new StyleLintPlugin({
      files: ['static/styles/**/*.scss'],
      syntax: 'scss',
      fix: false  // サーバーに自動修正させたければ true に
    }),
  ],
  optimization: {
    splitChunks: {
      cacheGroups: {
        commons: {
          test: /[\\/]node_modules[\\/]/,
          chunks: 'initial',
          name: 'vendor',
        },
      },
    },
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: false,
            },
          },
          {
            loader: 'eslint-loader',
            options: {
              enforce: 'pre',
              configFile: path.resolve(__dirname, '.eslintrc.js'),
              cache: false,
              fix: false,  // サーバーに自動修正させたければ true に
            },
          },
        ],
      },
      {
        test: /.(scss|css)$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
          },
          {
            loader: 'css-loader',

            options: {
              sourceMap: false,
              importLoaders: 2,
            },
          },
          {
            loader: 'postcss-loader',
          },
          {
            loader: 'sass-loader',

            options: {
              sourceMap: false,
              implementation: require('sass'),
              sassOptions: {
                fiber: require('fibers'),
              },
            },
          },
        ],
      },
    ],
  },
};

const devConfig = merge(baseConfig, {
  mode: 'development',
  output: {
    publicPath: 'http://localhost:3000/static/',
  },
  devServer: {
    port: 3000,
    headers: {
      "Access-Control-Allow-Origin": "*"  // For hot reload
    },
    watchOptions: {
      ignored: /node_modules/
    },

    watchContentBase: true,
    contentBase: [
      path.resolve(__dirname, 'templates'),
      path.resolve(__dirname, 'static'),
    ],
    proxy: {
      '/': 'http://localhost:8000',
    },
  },
});

const productConfig = merge(baseConfig, {
  mode: 'production',
  plugins: [
    // ビルド前にフォルダをきれいに
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: ["**/*"]
    }),
  ],
  optimization: {
    minimizer: [
      // 本番環境では, コメントと console.log を除去する
      new TerserPlugin({
        terserOptions: {
          extractComments: 'all',
          compress: { drop_console: true }
        }
      }),
    ]
  }
})

module.exports = (env, options) => {
  const isProduction = options.mode === 'production'
  return isProduction ? productConfig : devConfig
}
```

とりあえず､ こんなところでしょうか｡

自動整形は､ VSCodeにお願いするほうが好みなのでそっちで書いてます

リンター類の設定も書いておきます

``` js:.eslintrc.js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json'
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended"
  ],
  plugins: [
    "@typescript-eslint"
  ],
  rules: {
    "no-console": "off",
    "@typescript-eslint/quotes": [
      2,
      "backtick",
      {
        avoidEscape: true,
      },
    ],
  }
}
```

``` json:tsconfig.json
{
  "compilerOptions": {
    "target": "es2015",
    "module": "esnext",
    "lib": [
      "es2015",
      "dom"
    ],
    "strict": true,
  }
}
```

``` js:.stylelintrc.js
module.exports = {
  extends: [
    "stylelint-config-recommended",
    "stylelint-config-standard-scss",
    "stylelint-prettier/recommended"
  ],
  "plugins": [
    "stylelint-scss",
    "stylelint-prettier"
  ],
  defaultSeverity: "warning",
}
```

``` js:postcss.config.js
module.exports = {
  sourceMap: true,
  plugins: [
    // ベンダープレフィクスの自動付与
    require('autoprefixer')({
      grid: "autoplace"
    }),
    require('postcss-flexbugs-fixes')({}),
    require('cssnano')({ preset: 'default' }),
  ]
}
```

できたー

TypeScriptと､ SCSSに対応したので､ 用意した初期ファイルもそれぞれ拡張子を `.ts`, `.scss` に変更しつつ､ 適当に色々書いてみました

![](https://storage.googleapis.com/zenn-user-upload/runkeozpwia8usc9sbxdby4d64bc)

ホットリロードも働きますし､ スタイルもSCSSでかけるし､ 自動整形もしてくれますし､ 問題があれば `stylelint` / `eslint` が怒ってくれるのでこれでフロント側も快適に書くことができそうです

## 終わりに

今回は､ 特にフロントエンドのフレームワーク等導入しませんでしたが､ `Vue` や `React` 等も問題なく挟めるはずです｡

とはいえ､ フロントエンドフレームワークへの依存が大きくなり､ コードベースが増えるなら

[Using webpack with Django: it's not easy as you think](https://www.valentinog.com/blog/webpack-django/)

こちらの記事で指摘されているように､ モジュールが肥大化するので､ `splitChunks` を `chunks: 'all'` オプションを指定する必要がでてきますが､ `django-webpack-loader` はこれをサポートしませんので注意が必要です｡

ガッツリなSPAを複数繫いだようなマルチページアプリケーションを構築するなら､ 別の形を考える必要がありそうです｡

ありがとうございました🙇‍♂

## 参考

- [owais/django-webpack-loader](https://github.com/owais/django-webpack-loader)
- [Using webpack with Django: it's not easy as you think](https://www.valentinog.com/blog/webpack-django/)
- [How to Webpack your Django!](https://www.slideshare.net/DavidGibbons7/how-to-webpack-your-django)
