#!/usr/bin/env bash
set -euo pipefail

# Fetches proving key material and BLS params from the Midnight S3 bucket.
# Run once after cloning or when SDK version changes.
#
# Usage: ./scripts/fetch-proving-data.sh

S3="https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com"
VER=9
OUT="public/data/proving"

mkdir -p "$OUT/zswap/$VER" "$OUT/dust/$VER"

echo "Fetching circuit keys (version $VER)..."

for circuit in zswap/spend zswap/output zswap/sign dust/spend; do
  dir="${circuit%/*}"
  name="${circuit#*/}"
  for ext in prover verifier bzkir; do
    s3_path="$dir/$VER/$name.$ext"
    dest="$OUT/$s3_path"
    if [ -f "$dest" ]; then
      echo "  skip $s3_path (exists)"
      continue
    fi
    echo "  fetch $s3_path"
    curl -fsSL "$S3/$s3_path" \
      --retry 5 --retry-all-errors --retry-delay 2 \
      -o "$dest"
  done
done

echo "Fetching BLS params (k=10..16, bundled)..."

for ((k=10; k<=16; k++)); do
  file="bls_midnight_2p$k"
  dest="$OUT/$file"
  if [ -f "$dest" ]; then
    echo "  skip $file (exists)"
    continue
  fi
  echo "  fetch $file"
  curl -fsSL "$S3/$file" \
    --retry 5 --retry-all-errors --retry-delay 2 \
    -o "$dest"
done

echo ""
echo "Done. Total size:"
du -sh "$OUT"
