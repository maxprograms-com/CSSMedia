# CSSMedia DITA-OT plugin

`com.maxprograms.cssmedia` is a DITA Open Toolkit plug-in that generates PDF
output with [CSSMedia](https://www.npmjs.com/package/cssmedia). The DITA-OT
build pipeline does what it always does - validation, conrefs, keyrefs, topic
pulls and the map merge - and then hands the merged XML file to CSSMedia
instead of the XSL-FO/FOP pipeline. The merged file keeps coming from
DITA-OT, so filtering, filtering maps, the map topicrefs, conrefs and similar
toolkit features work exactly as they do for the default PDF output.

This plug-in pairs the DITA-OT's map merge with CSSMedia's XML-plus-CSS PDF
engine, using a stylesheet (and fonts) bundled inside the plug-in.

## What it does

Given a DITA map, the plug-in runs:

```
dita -i <map>.ditamap -f cssmedia [-o <path/to/outdir>]
```

This performs:

1. `preprocess2` - DITA-OT preprocessing (conrefs, keyrefs, topicpull, chunk
   handling, as usual)
2. the same `TopicMergeModule` merge that `org.dita.pdf2` uses for its PDF
   builds, producing `<mapname>_MERGED.xml` in the temporary directory
3. a small post-processor (`rewrite-images.js`) that rewrites the hashed
   image references of the merged file to the absolute source paths recorded
   in the job file - the same paths the FO pipeline resolves them to
4. CSSMedia: `cssmedia -x <mapname>_MERGED.cssmedia.xml -c dita-ot.css -p <mapname>.pdf`

## Output

The `-o` parameter is optional; by default the output goes to an `out` folder
**in the current working directory**, which is the default DITA-OT output
directory.

```sh
dita -i <map>.ditamap -f cssmedia            # writes to ./out
dita -i <map>.ditamap -f cssmedia -o build   # writes to ./build
```

The output directory contains only:

- `<mapname>.pdf` - the PDF

The merged XML and the image files are handled by the temporary directory,
not the output directory: the plugin renders the merged file from the
temporary directory, and DITA-OT deletes the temporary directory after the
build (its `--clean.temp` default). The images live in the source tree and
are rewritten to their absolute source paths before the render, so they
resolve regardless of the output location.

To keep the merged XML and the intermediate files for re-styling or
inspection, pass `--clean.temp=no`:

```sh
dita -i <map>.ditamap -f cssmedia --clean.temp=no
```

The temporary files stay in DITA-OT's temporary directory (the same location
the default PDF pipeline uses), where `<mapname>_MERGED.xml` and the
rewritten `<mapname>_MERGED.cssmedia.xml` can be found.

## Prerequisites

- [DITA Open Toolkit](https://www.dita-ot.org/) 4.x installed and on your PATH
  (the plug-in requires the `org.dita.pdf2` plug-in, which ships with the
  DITA Open Toolkit)
- Node.js 24 or newer
- CSSMedia installed globally:

  ```sh
  npm i -g cssmedia-x.y.z.tgz   # the CSSMedia tarball, from the CSSMedia releases
  ```

  Verify the command is available: `cssmedia --help`

## Installation

From this folder, pack the plug-in:

```sh
./pack.sh
```

This creates `com.maxprograms.cssmedia.zip` in this folder. The installer
reads `plugin.xml` from the root of the ZIP, which is what `pack.sh` arranges.

Install it:

```sh
dita install com.maxprograms.cssmedia.zip
```

You can now use the new `cssmedia` transformation type:

```sh
dita -i path/to/bookmap.ditamap -f cssmedia [-o <path/to/outdir>]
```

To stop using it:

```sh
dita uninstall com.maxprograms.cssmedia
```

## The default stylesheet and fonts

The plug-in bundles:

- `dita-ot.css` - an `samples/dita-ot.css` copy, adapted to the DITA-OT merged
  structure (the map comes first, then the topics), with an English and a
  Japanese font and page setup (A4, running headers and footers)
- `fonts/` - Noto Sans (Regular/Bold/Italic/BoldItalic), Noto Serif Display
  (Regular/Bold/Italic/BoldItalic), Noto Sans Mono and Noto Sans CJK JP, plus
  the OFL.txt license for the fonts

To use your own stylesheet instead of the bundled one, pass an override:

```sh
dita -i path/to/bookmap.ditamap -f cssmedia --args.cssmedia.css path/to/custom.css [-o <path/to/outdir>]
```

Any stylesheet that works with the merged file can be used this way. The
@font-face rules in the stylesheet are resolved relative to the stylesheet, so
ship your own fonts next to your own stylesheet if you want them.

To replace the bundled fonts, edit the `fonts/` folder inside the plug-in
directory and re-pack.

## Project layout

```
dita-ot/
  pack.sh            # packs plugin/ into com.maxprograms.cssmedia.zip
  plugin/            # the plug-in itself
    plugin.xml       # plug-in descriptor (id com.maxprograms.cssmedia)
    build.xml        # the dita2cssmedia target (merge + CSSMedia)
    rewrite-images.js # rewrites the merged file's hashed image references
    dita-ot.css
    fonts/           # fonts + OFL.txt
  README.md          # this file
```

## Notes

- The plug-in reuses DITA-OT's preprocess and its map merge, so the merged
  file is produced by the same pipeline as the default PDF output. The
  transformation type `cssmedia` is a new print type, available with the
  standard `-f`/`-o` command-line arguments.
- Output naming matches DITA-OT's own convention: the PDF is written to the
  output directory and is named after the map (or after `--args.output.base`
  if you pass it).
- The plug-in shells out to the global `cssmedia` command; it does not vendor
  CSSMedia or Node code.
