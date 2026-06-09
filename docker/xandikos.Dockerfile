# Self-hosted CalDAV/CardDAV server (spec §2.2 / §6) for local integration tests.
# The production deployment (§9) will add ntfy + --webdav-push; for the one-way
# push slice we only need a working CalDAV collection.
FROM python:3.12-slim

RUN pip install --no-cache-dir xandikos

EXPOSE 8000
ENTRYPOINT ["xandikos"]
CMD ["--autocreate", "-d", "/data", "-l", "0.0.0.0", "-p", "8000"]
