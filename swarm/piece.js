
/*
 * Pieces object that reads and writes piecelets
 * A piece object with a verify method
 * An active piece object as here
*/

var fs = require('graceful-fs')

var readStreamFunc = (path, start, end, file) => {

	return new Promise( (resolve, reject) => {

		file.read(start, end - start, function (err, buf) { 

			if(err)
				reject(err)
			else
				resolve(buf) 

		}) 

	})

}

var Pieces = (file) => class Piece {

	constructor(index) {

		this.hash = file.pieceHashes[index]

		this.path = file.path
		this.pathList = file.pathList
		this.files = file.files
		this.fileLengthList = file.fileLengthList

		this.index = index 
		this.isLast = index == file.numPieces - 1
		this.normalPieceLength = file.pieceLength
		this.pieceLength = this.isLast ? file.fileLength % file.pieceLength : file.pieceLength

	}

	readPiece() {

		let start = 0, end = this.pieceLength
		return this.readPiecelet(start, end)

	}

	async readPiecelet(begin, length) {

		let start = this.index * this.normalPieceLength + begin, end = start + length
		let chunks, leftBound = 0, fileBounds = []

		for(var i = 0 ; i <this.fileLengthList.length; i++) {

			let rightBound = leftBound + this.fileLengthList[i]

			if ( leftBound < start && rightBound > start || leftBound < end && rightBound > end )
				fileBounds.push([i, leftBound, rightBound])

			leftBound = rightBound

		}

		try {

			chunks = await Promise.all( fileBounds.map( async bound => {

				let chunkletStart = Math.max(bound[1], start), chunkletEnd = Math.min(bound[2], end)

				try {

					return await readStreamFunc(this.pathList[bound[0]], chunkletStart, chunkletEnd, this.files[bound[0]])

				} catch (error) {

					return null

				}

			}))

			return Buffer.concat(chunks)

		} catch (error) {

			return null

		}	

	}

	async verify() {

		let buf = await this.readPiece()

		if(!buf) 
			return this.good = false

		let hash = crypto.createHash('sha1').update(buf).digest('hex')

		return this.good = hash == this.hash

	}

}

var ActivePieces = (file) => class ActivePiece extends Pieces(file) {

	constructor(index) {

		super(index)

		this.pieceletLength = 2 ** 14
		this.numPiecelets = Math.ceil(this.pieceLength / this.pieceletLength) 
		this.piecelets = new Map() 
		this.requestList = new Map()
		this.dispatchList = new Map()

		this.left = 0
		this.right = this.left + this.pieceLength

		this.makeRequests()

	}

	* nextPiecelet() {

		let left = this.left, self = this

		while ( left < this.right ) {
			
			let length = (this.right - left) / this.pieceletLength > 1 ? this.pieceletLength : (this.right - left) 
			let request = { index : this.index, begin : left, length : length, dispatched : 0}
			yield request
			left += this.pieceletLength

		}

		return false

	}

	makeRequests() {

		var gen = this.nextPiecelet()
		var next = gen.next()

		while(!next.done) {

			let req = next.value
			this.requestList.set(req.begin + "," + (req.begin + req.length), req)
			next = gen.next()


		}

	}

	add(index, start, piecelet) {

		let left = start, right = left + piecelet.length
		this.piecelets.set(left + "," + right, piecelet)
		
		let request = this.requestList.get(start + "," + (start + piecelet.length))
		request.dispatched = 2

		//if(this.dispatchList.has(start + "," + (start + piecelet.length)))
		this.dispatchList.delete(start + "," + (start + piecelet.length))
		
		clearTimeout(request.timeout)
		
	}

	has(index, start, length) {

		let left = this.index * this.pieceletLength + start
		let right = left + length
		return this.piecelets.has(left + "," + right) 

	}

	get isComplete() {

		let left = this.left
		let newLeft = left

		do {

			left = newLeft
			newLeft = Math.max(left, ...Array.from(this.piecelets.keys()).filter( k => k.split(',')[0] <= left).map( k => k.split(',')[1]) )

		} while( left < this.right  && newLeft > left) 
	
		return left >= this.right

	}

	assemble() { 

		if(!this.isComplete) return 

		let left = this.left
		let buf = Buffer.alloc(this.pieceLength)

		do {

			let lefts = Array.from(this.piecelets.keys()).filter( k => Number(k.split(',')[0]) <= left)
			let maxRight = Math.max( ...lefts.map( k =>  Number(k.split(',')[1]) ) )
			let interval = lefts.find( k => k.split(',')[1] == maxRight )

			let piecelet = this.piecelets.get(interval)
			piecelet.copy(buf, Number(interval.split(',')[0]), 0, piecelet.length)

			left = maxRight

		} while( left < this.right ) 

		let hash = crypto.createHash('sha1').update(buf).digest('hex')

		if( hash == this.hash)
			return this.writePiece(buf)

		this.requestList.clear()
		this.dispatchList.clear()
		this.makeRequests()
		this.piecelets.clear()
		return false

	}

	writePiecelet(begin, length, buf) {

		let start = this.index * this.normalPieceLength
		let end = start + length
		let leftBound = 0, fileBounds = []

		for(var i = 0 ; i < this.fileLengthList.length; i++) {

			let rightBound = leftBound + this.fileLengthList[i]
			if ( leftBound < start && rightBound > start || leftBound < end && rightBound > end )
				fileBounds.push([i, leftBound, rightBound])
			leftBound = rightBound

		}

		try {

			fileBounds.forEach( bound => {

				let chunkletStart = Math.max(bound[1], start), chunkletEnd = Math.min(bound[2], end)
				let chunklet = buf.slice( (chunkletStart - start) , chunkletEnd - start)				
				this.files[bound[0]].write(chunkletStart, chunklet, function(err) {} )

			})

		} catch (error) {

			return false

		}

		return true

	}	

	writePiece(buf) {

		let start = this.index * this.normalPieceLength
		let end = start + this.pieceLength
		return this.writePiecelet(start, this.pieceLength, buf)

		let leftBound = 0, fileBounds = []

		for(var i = 0 ; i < this.fileLengthList.length; i++) {

			let rightBound = leftBound + this.fileLengthList[i]
			if ( leftBound < start && rightBound > start || leftBound < end && rightBound > end )
				fileBounds.push([i, leftBound, rightBound])
			leftBound = rightBound

		}

		try {

			fileBounds.forEach( bound => {

				let chunkletStart = Math.max(bound[1], start), chunkletEnd = Math.min(bound[2], end)
				let chunklet = buf.slice( (chunkletStart - start) , chunkletEnd - start)
				fs.createWriteStream( this.pathList[bound[0]], {start : chunkletStart, end: chunkletEnd - 1} ).end(chunklet)

			})

		} catch (error) {

			return false
		}

		return true

	}

	randPieceletReq(peer) {

		let self = this, idx = 0, req
		let arr = Array.from(this.requestList.values()) //too slow

		for( ; idx < arr.length; idx ++ ) {
			if(arr[idx].dispatched == 0) { //this.dispatchList.has(arr[idex].begin + "," + (arr[idx].begin + arr[idx.length]) )
				req = arr[idx]
				req.dispatched = 1
				this.dispatchList.set(req.begin + "," + (req.begin + req.length), req)
				break
			}
		}

		if(req) {

			var _putBack = () => {
				
				req.dispatched = req.dispatched == 2 ? 2 : 0
				this.dispatchList.delete(req.begin + "," + (req.begin + req.length))

			}

			req.timeout = setTimeout( _putBack, 30 * 1e3)
			req.putBack = _putBack

		}

		return req

	}

	requestsLeft() { //too slow

		return this.requestList.size - this.dispatchList.size
		//return Array.from(this.requestList.values()).reduce( (sum, request) => request.dispatched == 0 ? sum + 1 : sum, 0 )
	}	 

}

module.exports = {
	'Pieces' : Pieces,
	'ActivePieces' : ActivePieces
}

