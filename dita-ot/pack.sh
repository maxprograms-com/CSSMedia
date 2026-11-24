#!/bin/sh
# Packs the com.maxprograms.cssmedia DITA-OT plugin into a ZIP that you
# install with:  dita install com.maxprograms.cssmedia.zip
#
# The installer reads plugin.xml from the root of the ZIP, so the plugin
# files (the contents of plugin/) are the top level of the archive.
set -eu

cd "$(dirname "$0")"

NAME=com.maxprograms.cssmedia
OUTPUT="$NAME.zip"

rm -f "$OUTPUT"

cd plugin
zip -r "../$OUTPUT" . -x ".DS_Store"

echo "Wrote $OUTPUT"
