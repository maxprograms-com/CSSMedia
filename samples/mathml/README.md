# mathml

A DocBook 5 article with mathematics, "From Basel to Gauss: Sums, Products and Integrals". It is a math text: it has theorems, proofs, numbered display equations, formulas inside paragraphs, a footnote with a formula and a table. The formulas are written in MathML, in the paragraphs of the article.

| XML | Stylesheet | PDF |
| --- | ---------- | --- |
| [mathml.xml](mathml.xml) | [docbook.css](../docbook.css) | [mathml.pdf](mathml.pdf) |

## Generate the PDF

Run the command from the `samples` folder, the parent of this one:

```bash
cssmedia -x mathml/mathml.xml -c docbook.css -p mathml/mathml.pdf
```

The article is a DocBook 5 document, so it has no DTD and needs no catalog.

## What to look at

- Formulas that are part of a line of text and sit on its baseline, and display equations that are centered.
- The equation numbers at the right margin, and the references to them in the text. The numbers come from CSS counters, which count through the formulas and the rest of the document.
- A sum, a product, integrals, a matrix, a determinant, binomial coefficients and a limit.
- The geometric sum, which is written in Content MathML, where the others are written in Presentation MathML. Both are drawn with the same font.
- A footnote that has a formula in it, and a table whose header has formulas.
- The stylesheet is [docbook.css](../docbook.css), the same one that formats the [xml_gap](../xml_gap/) articles. Its last section has the numbering of sections and equations.
