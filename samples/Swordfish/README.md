# Swordfish

The User Guide of [Swordfish](https://maxprograms.com/products/swordfish.html), a real product, originally written in DITA. CSSMedia reads one XML file, so the map and its topics were merged in two ways. Each merged file has a different structure and needs its own stylesheet.

| Merged with | XML | Images | Stylesheet | PDF |
| ----------- | --- | ------ | ---------- | --- |
| [TypesDitac](https://github.com/maxprograms-com/TypesDitac) | [swordfish.xml](typesditac/swordfish.xml) | [img](typesditac/img) | [ditac.css](../ditac.css) | [swordfish.pdf](typesditac/swordfish.pdf) |
| [TypesDitac](https://github.com/maxprograms-com/TypesDitac) | [swordfish.xml](typesditac/swordfish.xml) | [img](typesditac/img) | [ditac_hyphens.css](../ditac_hyphens.css) | [swordfish_hyphens.pdf](typesditac/swordfish_hyphens.pdf) |
| DITA Open Toolkit | [swordfish_dita-ot.xml](dita-ot/swordfish_dita-ot.xml) | [images](dita-ot/images) | [dita-ot.css](../dita-ot.css) | [swordfish_dita-ot.pdf](dita-ot/swordfish_dita-ot.pdf) |

## Generate the PDFs

Run the commands from the `samples` folder, the parent of this one:

```bash
cssmedia -x Swordfish/typesditac/swordfish.xml -c ditac.css -p Swordfish/typesditac/swordfish.pdf
cssmedia -x Swordfish/typesditac/swordfish.xml -c ditac_hyphens.css -p Swordfish/typesditac/swordfish_hyphens.pdf
cssmedia -x Swordfish/dita-ot/swordfish_dita-ot.xml -c dita-ot.css -p Swordfish/dita-ot/swordfish_dita-ot.pdf
```

## The stylesheets

| Stylesheet | Input | Hyphenation |
| ---------- | ----- | ----------- |
| `ditac.css` | TypesDitac file | none |
| `ditac_hyphens.css` | TypesDitac file | `hyphens: auto` on the root element, with the patterns of each language |
| `dita-ot.css` | DITA-OT file: the map comes first, then the topics | none |

The main [README](../../README.md#merging-a-dita-map) explains how to create a merged file with TypesDitac or with the DITA Open Toolkit.
