# Dev toolchain image: Node 22 + pnpm.
# The repo is bind-mounted at /work by compose.yaml — we deliberately do NOT
# COPY sources into the image, so edits on the host are picked up immediately.
FROM node:22-bookworm-slim

# pnpm is installed globally (world-readable) so it works for any runtime UID.
# We run the dev container as the `node` user (UID 1000) to match the host user,
# which keeps files created in the bind mount owned by the host, not root.
RUN npm install -g pnpm@9 && npm cache clean --force

WORKDIR /work
