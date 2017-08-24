


var Pieces = (file) => class Piece {

	constructor(index) {

		this.path = this.file //path to file on disk
		this.hash = file.pieceHashes[index]

		this.index = index
		this.isLast = this.index == file.numPieces - 1
		this.pieceLength = this.isLast ? file.fileLength % file.pieceLength : file.pieceLength

		this.pieceletLength = 2 ** 14
		this.numPiecelets = Math.ceil(this.pieceLength / this.pieceletLength) 
		this.piecelets = new Map() //have these piecelet buffers
		this.left = index * this.pieceLength //byte endpoint
		this.right = this.left + this.pieceLength //byte endpoint

		//remove req from arr on issue, add back when fail
		this.requests = [] // [ {index, start, length } , {index, start, length} , ... ]


		this.nextPiecelet = function *() {

			let left = this.left

			while ( left < this.right ) {
				
				let length = (this.right - left) / this.pieceletLength > 1 ? this.pieceletLength : (this.right - left) 
				yield {index : this.index, begin : left, length : length, putBack : this.putBack}
				left += this.pieceletLength
			}

			return false

		}

		this.makeRequests()

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

	putBack(req) {

		this.requests.push(req)

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

		//check hash
		//if error rebuild requests 
		//keep piecelets and replace
		let hash = crypto.createHash('sha1')
		let hashValue = hash.update(buf).digest('hex')
		if( hashValue == this.hash) { 

			fs.createWriteStream(this.path, {'start': this.left, 'end' : this.right, highWaterMark : 2**15}).write(buf)
			return true
		
		} 

		//startover
		this.makeRequests()
		return false


	}
	
	randPieceletReq() {

		let reqIdx = Math.floor(Math.random() * this.requests.length)
		return this.requests.splice(reqIdx, 1)[0]
		//return this.nextPiecelet.next(args)

	}	 

}

module.exports = {
	'Pieces' : Pieces
}

