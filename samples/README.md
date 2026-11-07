# Samples

XML files, the stylesheets that format them, and the fonts the stylesheets use.

| Item | Contents |
| ---- | -------- |
| [xml_gap](xml_gap/) | A DocBook article in English, Arabic, Japanese and Russian, with the generated PDFs. [Read more](xml_gap/README.md). |
| [Swordfish](Swordfish/) | The User Guide of [Swordfish](https://maxprograms.com/products/swordfish.html), a real product, merged from DITA with TypesDitac and with the DITA Open Toolkit, with the generated PDFs. [Read more](Swordfish/README.md). |
| [fonts](fonts/) | The Noto fonts that the stylesheets load with `@font-face`. |

## Stylesheets

The stylesheets are in this folder. They load the fonts from `./fonts`, a path relative to the stylesheet, so keep the stylesheets next to the `fonts` folder.

| Stylesheet | Formats |
| ---------- | ------- |
| [xml_gap.css](xml_gap.css) | The four files in `xml_gap` |
| [ditac.css](ditac.css) | The Swordfish file merged with TypesDitac |
| [ditac_hyphens.css](ditac_hyphens.css) | The same file, with automatic hyphenation |
| [dita-ot.css](dita-ot.css) | The Swordfish file merged with the DITA Open Toolkit |

## Fonts

The fonts are published under the [SIL Open Font License 1.1](https://github.com/notofonts/noto-fonts/blob/main/LICENSE). The folder has the Noto fonts that the sample stylesheets load, such as Noto Sans, Noto Sans Mono, Noto Sans Arabic UI, Noto Sans CJK JP and Noto Serif Display.

The commands to generate each PDF are in the README of each subfolder.
