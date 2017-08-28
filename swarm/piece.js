
/*

Pieces object that reads and writes piecelets

A piece object with a verify method

An active piece object as here


*/

var readStreamFunc = async (path, start, end) => {

	let pieceStream = fs.createReadStream(path, {start : start , end : end - 1})

	return new Promise( (resolve, reject) => {

		pieceStream.on('readable', () => { 
			let data = pieceStream.read(end - start)  
			if(data)
				resolve(data) 
		})
})}

var Pieces = (file) => class Piece {

	constructor(index) {

		this.fileMetaData = file
		this.hash = file.pieceHashes[index]

		this.path = file //path to file on disk
		this.pathList = file.pathList
		
		this.fileLengthList = file.fileLengthList

		this.index = index 
		this.isLast = index == file.numPieces - 1
		this.normalPieceLength =  file.pieceLength
		this.pieceLength = this.isLast ? file.fileLength % file.pieceLength : file.pieceLength

	}

	readPiece() {

		//let start = this.index * this.normalPieceLength, end = start + this.pieceLength
		let start = 0, end = this.pieceLength
		return this.readPiecelet(start, end)

	}

	async readPiecelet(begin, length) {

		let start = this.index * this.normalPieceLength + begin, end = start + length

		let metaData = this.fileMetaData
		let chunks

		let leftBound = 0, fileBounds = []

		for(var i = 0 ; i < metaData.fileLengthList.length; i++) {

			let rightBound = leftBound + metaData.fileLengthList[i]
			if ( leftBound < start && rightBound > start || leftBound < end && rightBound > end )
				fileBounds.push([i, leftBound, rightBound])
			leftBound = rightBound

		}

		try {

			console.log(fileBounds)
			chunks = await Promise.all( fileBounds.map( bound => {

				let chunkletStart = Math.max(bound[1], start), chunkletEnd = Math.min(bound[2], end)
				return readStreamFunc(metaData.pathList[bound[0]], chunkletStart, chunkletEnd)

			}))

			return Buffer.concat(chunks)

		} catch (error) {
			console.log(error)
			return false

		}

		

	}

	async verify() {

		let buf = await this.readPiece()

		let hash = crypto.createHash('sha1').update(buf).digest('hex')
		console.log(hash, this.hash)
		return this.good = hash == this.hash

	}

}

var ActivePieces = (file) => class ActivePiece extends Pieces(file) {

	constructor(index) {

		super(index)		

		this.pieceletLength = 2 ** 14
		this.numPiecelets = Math.ceil(this.pieceLength / this.pieceletLength) 
		this.piecelets = new Map() 
		this.left = index * this.pieceLength 
		this.right = this.left + this.pieceLength
		this.makeRequests()

	}

	* nextPiecelet() {

			let left = this.left, self = this

			while ( left < this.right ) {
				
				let length = (this.right - left) / this.pieceletLength > 1 ? this.pieceletLength : (this.right - left) 
				let request = { index : this.index, begin : left, length : length}
				request.putBack = () => { self.requests.push(request) }
				yield request
				left += this.pieceletLength
			}

			return false

	}

	makeRequests() {

		this.requests = []
		var gen = this.nextPiecelet()
		var next = gen.next()
		while(next) {
			this.requests.push(next)
			next = gen.next()
		}

	}

	add(index, start, piecelet) {

		let left = this.index * this.pieceletLength + start
		let right = left = pieceletLength
		this.piecelets.set(left+","+right, piecelet)
		
	}

	has(index, start, length) {

		let left = this.index * this.pieceletLength + start
		let right = left + length
		return !!this.piecelets.get(left+","+right) 

	}

	get isComplete() {

		let left = this.left
		let newLeft = left

		do {

			left = newLeft
			newLeft = Math.max(left, ...Array.from(this.piecelets).filter( k => k.split(',')[0] <= left).map( k => k.split(',')[1]) )

		} while( left < this.right  && newLeft > left) 
	
		return left >= this.right

	}

	assemble() { 

		if(!this.isComplete) return 

		let left = this.left
		let buf = Buffer.alloc(0, this.pieceLength)

		do {

			let lefts = Array.from(this.piecelets).filter( k => k.split(',')[0] <= left)
			let maxRight = Math.max(lefts.map( k => k.split(',')[1])  )
			let interval = lefts.find( k => k.split(',')[1] == maxRight )
			let piecelet = this.piecelets.get(interval)
			piecelet.copy(buf, Number(interval.split(',')[0]), 0, this.piecelet.length)
			left = maxRight

		} while( left < this.right ) 

		let hash = crypto.createHash('sha1')
		let hashValue = hash.update(buf).digest('hex')
		if( hashValue == this.hash) { 

			this.writePiece(buf)
			return true
		
		} 

		//startover
		this.makeRequests()
		return false


	}

	writePiece(buf) {

		let metaData = this.fileMetaData
		let start = this.index * this.file.pieceLength
		let end = start + this.pieceLength

		let fileBounds = [ [0, 0, metaData.fileLengthList[0]] ]

		for(var i = 1 ; i < metaData.fileLengthList.length - 1; i++) {

			let bound = fileBounds[i-1][2]
			fileBounds.push( [i, bound,  bound + metaData.fileLengthList[i] ] )

		}

		fileBounds.filter( (bound) => bound[0] < start && bound[1] > start || bound[0] < end && bound[1] > end ).forEach( (bound, i, v) => {

			let chunkletStart = Math.max(bound[1], start), chunkletEnd = Math.min(bound[2], end)
			createWriteStream( metaData.pathList[bound[0]], {start : chunkletStart, end: chunkletEnd} ).end(buf.slice(bound[1] % metaData.pieceLength, bound[2] % metaData.pieceLength ))

		})

	}	

	randPieceletReq() {

		let reqIdx = Math.floor(Math.random() * this.requests.length)
		return this.requests.splice(reqIdx, 1)[0]

	}	 

}

module.exports = {
	'Pieces' : Pieces,
	'ActivePieces' : ActivePieces
}

