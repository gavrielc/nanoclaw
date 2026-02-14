FROM mcr.microsoft.com/devcontainers/typescript-node

RUN apt-get update && apt-get -y install --no-install-recommends curl git sqlite3 gnupg

RUN curl -fsSL https://claude.ai/install.sh | bash