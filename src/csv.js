const LIMIT=1048576;
export function csvRows(input,{maxRows=100,maxColumns=Infinity}={}){
 if(typeof input!=='string'||input.length>LIMIT||new TextEncoder().encode(input).length>LIMIT)throw new RangeError('CSV input too large');
 const text=input.replace(/^\uFEFF/,'');
 if(!text.length)throw new TypeError('empty CSV');
 const rows=[];let row=[],field='',state='start';
 function endField(){if(row.length>=maxColumns)throw new RangeError('CSV column limit');row.push(field);field='';state='start';}
 function endRow(){endField();rows.push(row);row=[];if(rows.length>maxRows+1)throw new RangeError('CSV batch too large');}
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(state==='quoted'){
   if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else state='afterQuote';}
   else field+=c;
  }else if(c===','){endField();}
  else if(c==='\n'||c==='\r'){
   if(c==='\r'&&text[i+1]!=='\n')throw new SyntaxError('bare carriage return in CSV');
   if(c==='\r')i++;
   endRow();
  }else if(state==='afterQuote')throw new SyntaxError('unexpected text after CSV quote');
  else if(c==='"'){
   if(state!=='start')throw new SyntaxError('unexpected CSV quote');
   state='quoted';
  }else{field+=c;state='plain';}
 }
 if(state==='quoted')throw new SyntaxError('unterminated CSV quote');
 if(row.length||field.length||state!=='start')endRow();
 return rows;
}
