#!/bin/bash

while true; do
    codex exec \
      --dangerously-bypass-approvals-and-sandbox \
      "$(cat ralph.txt)"

    git add -A
    git commit -m "Codex iteration" || true

    if [ -f .codex_done ]; then
        echo "Implementation complete."
        break
    fi
done
