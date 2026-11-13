typesditac CSSMedia.ditamap --merge -o CSSMedia_MERGED.xml 
cssmedia -x CSSMedia_MERGED.xml -c stylesheets/ditac.css -p CSSMedia.pdf 
rm CSSMedia_MERGED.xml
rm -rf img/

