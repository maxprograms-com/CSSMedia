typesditac CSSMedia.ditamap --merge -o CSSMedia_MERGED.xml 
cssmedia -x CSSMedia_MERGED.xml -c stylesheets/ditac.css -p CSSMedia.pdf 
rm CSSMedia_MERGED.xml
rm -rf img/

typesditac CSSReference.ditamap --merge -o CSSReference_MERGED.xml 
cssmedia -x CSSReference_MERGED.xml -c stylesheets/ditac.css -p CSSReference.pdf 
rm CSSReference_MERGED.xml
rm -rf img/

# rm -rf out
#  ../../ditac/bin/ditac -p mathjax yes -f webhelp5 ./out/cssmedia.html ./CSSMedia.ditamap
