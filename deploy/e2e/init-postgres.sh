#!/usr/bin/env bash
# Creates the two databases needed by the E2E stack.
# Runs as the postgres superuser (POSTGRES_USER) at container first-start.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
  CREATE DATABASE authentik;
  CREATE DATABASE fuzefront_platform;
SQL
