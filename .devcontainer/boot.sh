#!/usr/bin/env bash

sudo apt-get update
sudo apt-get install -y clang

#
# Permissions
#
chown -R node:node /home/node/.config
chown -R node:node /home/node/.local
