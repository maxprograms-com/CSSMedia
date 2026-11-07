# CSSMedia Manual

CSSMedia reads an XML document and a CSS stylesheet. The stylesheet describes how you want selected XML elements to look in the PDF. CSSMedia treats element names and attributes as data. It does not assume that a name such as `chapter` or an attribute such as `class` has a particular meaning.

The *CSSMedia User Guide* is written using DITA XML and the PDF version is generated using CSSMedia itself.

## Requirements to build the PDF

You need to have `typesditac` and `cssmedia` installed and available in your system's PATH.

``` bash
npm i -g typesditac
```

To install `cssmedia`, run the following commands:

``` bash
npm i -g file:cssmedia-x.x.x.tgz
```

Where `x.x.x` is the version of CSSMedia that you downloaded or built.

## Build the PDF

A CSS file and the fonts needed for the manual are available in this folder.

Execute these commands to build `CSSMedia.pdf`:

``` bash
typesditac CSSMedia.ditamap --merge -o CSSMedia_MERGED.xml 
cssmedia -x CSSMedia_MERGED.xml -c stylesheets/ditac.css -p CSSMedia.pdf 
rm CSSMedia_MERGED.xml
rm -rf img/
```
