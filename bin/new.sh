#!/bin/bash

printf "Input slug > "; read slug
npx zenn new:article --slug $slug --type tech
