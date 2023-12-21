#!/bin/bash

lower=$(uuidgen | tr '[:upper:]' '[:lower:]')
filename=$(yarn zenn new:article --slug $lower --type tech --machine-readable)
printf "Summary File Name >> "; read new_filename;

mv articles/$filename articles/${new_filename}.md
