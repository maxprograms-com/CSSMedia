# xml_gap

A DocBook article in four languages. The same stylesheet, [xml_gap.css](../xml_gap.css), formats all of them.

The Arabic, Japanese and Russian files were translated automatically with DeepL. The goal of the samples is to test typesetting, not to provide perfect localization.

| Language | XML | PDF |
| -------- | --- | --- |
| English | [xml_gap.xml](xml_gap.xml) | [xml_gap.pdf](xml_gap.pdf) |
| Arabic | [xml_gap_ar.xml](xml_gap_ar.xml) | [xml_gap_ar.pdf](xml_gap_ar.pdf) |
| Japanese | [xml_gap_ja.xml](xml_gap_ja.xml) | [xml_gap_ja.pdf](xml_gap_ja.pdf) |
| Russian | [xml_gap_ru.xml](xml_gap_ru.xml) | [xml_gap_ru.pdf](xml_gap_ru.pdf) |

## Generate a PDF

Run the command from the `samples` folder, the parent of this one:

```bash
cssmedia -x xml_gap/xml_gap.xml -c xml_gap.css -p xml_gap/xml_gap.pdf
```

The files declare a DocBook DTD. Without a catalog, CSSMedia prints the warning `External subset not found: docbook/docbookx.dtd` and still generates the PDF. To avoid the warning, pass a catalog that resolves the DTD with `-g`.

## What to look at

- Right-to-left text in the Arabic file, with the photo at the start side of the text.
- Japanese text with its own font and line breaking.
- Links, a footer with the document title and the page number, and code listings in a monospace font.
- The stylesheet is short, so you can read it in full. The [main README](../../README.md#xml_gap) lists the techniques it uses.
