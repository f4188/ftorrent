exports = {
	'benDecode' = decode,
	'benEncode' = encode
}

//str or buffer
decode(buf, i) {
	//check null, undefined or length == 0
	if(buf || buf.length == 0) return {}
	//check if buffer or string


	
	let pos = i
	let dict, list, int, j

	//let char = 
	if('d') {
		dict, j = decodeDict(buf, pos)
		if()

	} else if( 'l') {
		list, j = decodeList()

	} else if ('i') {
		int, j = decodeInt()

	} else if () //num

}

decodeDict()


//dict d ... e
//list l .... e
//integer i ... e
//string  len : ...