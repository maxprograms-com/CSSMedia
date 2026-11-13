typesditac CSSMedia.ditamap --merge -o CSSMedia_MERGED.xml 
cssmedia -x CSSMedia_MERGED.xml -c stylesheets/ditac.css -p CSSMedia.pdf 
rm CSSMedia_MERGED.xml
rm -rf img/

typesditac CompleteReferenceHelp.ditamap --merge -o CompleteReferenceHelp_MERGED.xml 
cssmedia -x CompleteReferenceHelp_MERGED.xml -c stylesheets/ditac.css -p CSSReference.pdf 
rm CompleteReferenceHelp_MERGED.xml
rm -rf img/

